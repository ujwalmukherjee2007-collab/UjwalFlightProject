import { useState, useEffect, useCallback } from 'react';
import { distanceInMiles, boundingBox, metersToFeet, headingToCompass } from './utils.js';

// In local dev, this is empty and Vite's proxy (vite.config.js) forwards /api to the
// backend on localhost:5000. In production, set VITE_API_URL to your deployed backend's
// URL (e.g. https://your-backend.onrender.com) as an environment variable on your
// hosting provider — see README for the deployment walkthrough.
const API_BASE = import.meta.env.VITE_API_URL || '';

const DEFAULT_RADIUS_MILES = 5;
const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 50; // beyond this, anonymous OpenSky requests get slow/heavy

function App() {
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [routeLookups, setRouteLookups] = useState({}); // icao24 -> { loading, source, destination, error }
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [radiusInput, setRadiusInput] = useState(String(DEFAULT_RADIUS_MILES));

  // Step 1: get the user's current location once on load.
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setLocationError(
          'Could not get your location. Please allow location access and refresh the page.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Step 2: fetch nearby flights from OpenSky whenever we have a location.
  const fetchFlights = useCallback(async () => {
    if (!location) return;
    setLoading(true);
    setError('');

    try {
      const { lamin, lamax, lomin, lomax } = boundingBox(location.lat, location.lon, radiusMiles);
      const url = `${API_BASE}/api/flights?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server returned status ${res.status}`);
      }

      const states = data.states || [];

      const parsed = states
        .map((s) => ({
          icao24: s[0],
          callsign: (s[1] || '').trim() || 'Unknown',
          originCountry: s[2],
          longitude: s[5],
          latitude: s[6],
          baroAltitudeM: s[7],
          onGround: s[8],
          velocityMs: s[9],
          heading: s[10],
          geoAltitudeM: s[13]
        }))
        .filter((f) => f.latitude !== null && f.longitude !== null)
        .map((f) => ({
          ...f,
          distanceMiles: distanceInMiles(location.lat, location.lon, f.latitude, f.longitude)
        }))
        .filter((f) => f.distanceMiles <= radiusMiles)
        .sort((a, b) => a.distanceMiles - b.distanceMiles);

      setFlights(parsed);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      setError(
        err.message ||
          'Could not fetch flight data. Check your internet connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [location, radiusMiles]);

  useEffect(() => {
    if (location) {
      fetchFlights();
    }
  }, [location, fetchFlights]);

  // Best-effort route lookup. OpenSky's flights/aircraft endpoint is historical and
  // rate-limited, and often has no data for a flight still in progress — so this is
  // opt-in per row rather than automatic for every flight in the table.
  const lookupRoute = async (icao24) => {
    setRouteLookups((prev) => ({ ...prev, [icao24]: { loading: true } }));

    try {
      const url = `${API_BASE}/api/route?icao24=${icao24}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Status ${res.status}`);
      }

      if (!data || data.length === 0) {
        setRouteLookups((prev) => ({
          ...prev,
          [icao24]: { loading: false, source: 'Unknown', destination: 'Unknown' }
        }));
        return;
      }

      const latest = data[data.length - 1];
      const dep = latest.departureAirportInfo;
      const arr = latest.arrivalAirportInfo;

      setRouteLookups((prev) => ({
        ...prev,
        [icao24]: {
          loading: false,
          source: dep ? `${dep.city} (${dep.icao})` : 'Unknown',
          destination: arr ? `${arr.city} (${arr.icao})` : 'In progress / unknown'
        }
      }));
    } catch (err) {
      setRouteLookups((prev) => ({
        ...prev,
        [icao24]: { loading: false, error: 'Lookup failed or rate-limited' }
      }));
    }
  };

  // Validates and applies the user's radius input. Clamps to sane bounds so a typo
  // (like 5000 miles) doesn't send a huge, slow, or invalid bounding box to OpenSky.
  const applyRadius = () => {
    const parsed = parseFloat(radiusInput);

    if (isNaN(parsed) || parsed <= 0) {
      setRadiusInput(String(radiusMiles));
      return;
    }

    const clamped = Math.min(Math.max(parsed, MIN_RADIUS_MILES), MAX_RADIUS_MILES);
    setRadiusInput(String(clamped));
    setRadiusMiles(clamped);
  };

  const handleRadiusKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyRadius();
    }
  };

  return (
    <div className="container">
      <h1>Flights Within {radiusMiles} Miles</h1>
      <p className="subtitle">Live aircraft near your current location, via OpenSky Network.</p>

      {locationError && <p className="error">{locationError}</p>}

      {location && (
        <p className="location-info">
          Your location: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
        </p>
      )}

      <div className="controls">
        <div className="radius-input">
          <label htmlFor="radius">Search radius (miles):</label>
          <input
            id="radius"
            type="number"
            min={MIN_RADIUS_MILES}
            max={MAX_RADIUS_MILES}
            step="1"
            value={radiusInput}
            onChange={(e) => setRadiusInput(e.target.value)}
            onKeyDown={handleRadiusKeyDown}
            onBlur={applyRadius}
          />
          <button onClick={applyRadius} disabled={!location}>
            Apply
          </button>
        </div>
        <button onClick={fetchFlights} disabled={!location || loading}>
          {loading ? 'Refreshing...' : 'Refresh Now'}
        </button>
        {lastUpdated && (
          <span className="last-updated">Last updated: {lastUpdated.toLocaleTimeString()}</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {!loading && location && flights.length === 0 && !error && (
        <p className="empty-state">No aircraft currently detected within {radiusMiles} miles.</p>
      )}

      {flights.length > 0 && (
        <table className="flight-table">
          <thead>
            <tr>
              <th>Flight / Callsign</th>
              <th>Altitude</th>
              <th>Speed</th>
              <th>Direction</th>
              <th>Distance</th>
              <th>Source</th>
              <th>Destination</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => {
              const routeInfo = routeLookups[f.icao24];
              const altitudeFt = metersToFeet(f.geoAltitudeM ?? f.baroAltitudeM);
              const speedMph = f.velocityMs ? Math.round(f.velocityMs * 2.23694) : null;
              const compass = headingToCompass(f.heading);

              return (
                <tr key={f.icao24}>
                  <td>
                    <div className="callsign">{f.callsign}</div>
                    <div className="origin-country">{f.originCountry}</div>
                  </td>
                  <td>{f.onGround ? 'On ground' : altitudeFt !== null ? `${altitudeFt.toLocaleString()} ft` : '—'}</td>
                  <td>{speedMph !== null ? `${speedMph} mph` : '—'}</td>
                  <td>
                    {f.onGround
                      ? '—'
                      : compass
                        ? `${compass} (${Math.round(f.heading)}°)`
                        : '—'}
                  </td>
                  <td>{f.distanceMiles.toFixed(2)} mi</td>
                  <td colSpan={routeInfo && !routeInfo.loading && !routeInfo.error ? 1 : 2}>
                    {!routeInfo && (
                      <button className="route-btn" onClick={() => lookupRoute(f.icao24)}>
                        Look up route
                      </button>
                    )}
                    {routeInfo?.loading && <span>Looking up...</span>}
                    {routeInfo?.error && <span className="error-inline">{routeInfo.error}</span>}
                    {routeInfo && !routeInfo.loading && !routeInfo.error && routeInfo.source}
                  </td>
                  {routeInfo && !routeInfo.loading && !routeInfo.error && (
                    <td>{routeInfo.destination}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="disclaimer">
        Route (source/destination) data is historical and best-effort — OpenSky's free tier
        often has no route info for flights still in the air. Position and altitude data
        typically has a delay of several seconds to a couple of minutes.
      </p>
    </div>
  );
}

export default App;
