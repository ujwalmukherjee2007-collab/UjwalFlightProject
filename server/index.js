import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Airport ICAO -> { name, city, country } lookup, built from the OurAirports public
// domain dataset (https://ourairports.com/data/). OpenSky only ever gives us ICAO
// codes (e.g. "KJFK"), never a city name, so this fills that gap locally with no
// extra API calls or rate-limit cost.
const airportLookup = JSON.parse(readFileSync(join(__dirname, 'airports.json'), 'utf-8'));

function resolveAirport(icaoCode) {
  if (!icaoCode) return null;
  const info = airportLookup[icaoCode.toUpperCase()];
  if (!info) return { icao: icaoCode, city: 'Unknown', name: 'Unknown', country: null };
  return { icao: icaoCode, city: info.city || 'Unknown', name: info.name, country: info.country };
}

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

// OpenSky's API doesn't reliably send Access-Control-Allow-Origin, so browsers block
// direct requests to it. This server fetches on the browser's behalf and returns the
// data with CORS enabled for our own frontend — a standard proxy workaround.
app.get('/api/flights', async (req, res) => {
  try {
    const { lamin, lomin, lamax, lomax } = req.query;
    if (!lamin || !lomin || !lamax || !lomax) {
      return res.status(400).json({ error: 'Missing bounding box parameters.' });
    }

    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const response = await fetch(url);

    if (response.status === 429) {
      return res.status(429).json({
        error:
          "OpenSky's daily limit for anonymous requests (400/day) has been reached. This resets after 24 hours."
      });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `OpenSky API returned status ${response.status}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reach OpenSky. Check server internet access.' });
  }
});

// Best-effort route (source/destination) lookup — see README for its limitations.
app.get('/api/route', async (req, res) => {
  try {
    const { icao24 } = req.query;
    if (!icao24) {
      return res.status(400).json({ error: 'Missing icao24 parameter.' });
    }

    const now = Math.floor(Date.now() / 1000);
    const sixHoursAgo = now - 6 * 60 * 60;
    const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${sixHoursAgo}&end=${now}`;

    const response = await fetch(url);

    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate-limited by OpenSky. Try again later.' });
    }
    if (!response.ok) {
      // OpenSky returns 404 when there's simply no route data — not a real error.
      if (response.status === 404) {
        return res.json([]);
      }
      return res.status(502).json({ error: `OpenSky API returned status ${response.status}` });
    }

    const data = await response.json();

    // Attach resolved city/name info for the departure and arrival airports,
    // alongside the raw ICAO codes OpenSky gives us.
    const enriched = data.map((flight) => ({
      ...flight,
      departureAirportInfo: resolveAirport(flight.estDepartureAirport),
      arrivalAirportInfo: resolveAirport(flight.estArrivalAirport)
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reach OpenSky. Check server internet access.' });
  }
});

app.listen(PORT, () => {
  console.log(`Flight tracker proxy server running on http://localhost:${PORT}`);
});
