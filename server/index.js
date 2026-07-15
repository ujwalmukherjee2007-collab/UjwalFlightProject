import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

// --- Data sources ---
// Live positions: adsb.lol (https://api.adsb.lol) — a free, open, community-run
// ADS-B aggregator. Unlike OpenSky, it's explicitly built for open public/programmatic
// use and doesn't block cloud-hosting IP ranges, which OpenSky does (see their own
// GitHub notice: "We may block AWS and other hyperscalers due to generalized abuse").
//
// Route lookups: adsbdb.com (https://api.adsbdb.com) — a free, open API that maps a
// flight's callsign to its origin/destination airport (with city names included).
// This actually works for flights still in progress, unlike OpenSky's historical-only
// route data, since it looks up the scheduled route for the callsign directly rather
// than waiting for the flight to land.

function nauticalMilesFromMiles(miles) {
  return miles * 0.868976;
}

app.get('/api/flights', async (req, res) => {
  try {
    const { lat, lon, radiusMiles } = req.query;
    if (!lat || !lon || !radiusMiles) {
      return res.status(400).json({ error: 'Missing lat, lon, or radiusMiles parameter.' });
    }

    // adsb.lol's point-radius query caps at 250 nautical miles.
    const radiusNm = Math.min(nauticalMilesFromMiles(parseFloat(radiusMiles)), 250);
    const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`;

    const response = await fetch(url);

    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate-limited by adsb.lol. Try again in a moment.' });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `adsb.lol API returned status ${response.status}` });
    }

    const data = await response.json();
    const aircraftList = data.ac || [];

    // Normalize adsb.lol's fields (feet, knots, "ground" sentinel string) into the
    // shape the frontend expects (meters, m/s, boolean on-ground flag).
    const states = aircraftList.map((ac) => {
      const onGround = ac.alt_baro === 'ground';
      return {
        icao24: ac.hex || null,
        callsign: (ac.flight || '').trim() || null,
        originCountry: null, // not provided by this data source
        longitude: typeof ac.lon === 'number' ? ac.lon : null,
        latitude: typeof ac.lat === 'number' ? ac.lat : null,
        onGround,
        baroAltitudeM:
          typeof ac.alt_baro === 'number' ? ac.alt_baro / 3.28084 : null,
        geoAltitudeM:
          typeof ac.alt_geom === 'number' ? ac.alt_geom / 3.28084 : null,
        velocityMs: typeof ac.gs === 'number' ? ac.gs * 0.514444 : null,
        heading: typeof ac.track === 'number' ? ac.track : null
      };
    });

    res.json({ states });
  } catch (err) {
    console.error('Error in /api/flights:', err);
    res.status(500).json({
      error: `Could not reach adsb.lol: ${err.message || err.cause?.message || 'unknown network error'}`
    });
  }
});

app.get('/api/route', async (req, res) => {
  try {
    const { callsign } = req.query;
    if (!callsign || !callsign.trim()) {
      return res
        .status(400)
        .json({ error: 'No callsign available for this aircraft — route lookup needs one.' });
    }

    const url = `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign.trim())}`;
    const response = await fetch(url);

    if (response.status === 404) {
      // adsbdb has no route on file for this callsign — not an error, just unknown.
      return res.json({ source: null, destination: null });
    }
    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate-limited by adsbdb.com. Try again in a moment.' });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `adsbdb API returned status ${response.status}` });
    }

    const data = await response.json();
    const route = data?.response?.flightroute;

    if (!route) {
      return res.json({ source: null, destination: null });
    }

    const shapeAirport = (airport) =>
      airport
        ? {
            city: airport.municipality || 'Unknown',
            name: airport.name,
            icao: airport.icao_code,
            iata: airport.iata_code,
            country: airport.country_name
          }
        : null;

    res.json({
      airline: route.airline?.name || null,
      source: shapeAirport(route.origin),
      destination: shapeAirport(route.destination)
    });
  } catch (err) {
    console.error('Error in /api/route:', err);
    res.status(500).json({
      error: `Could not reach adsbdb.com: ${err.message || err.cause?.message || 'unknown network error'}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Flight tracker proxy server running on http://localhost:${PORT}`);
});
