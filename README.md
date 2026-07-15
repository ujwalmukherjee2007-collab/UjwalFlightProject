# Nearby Flights Tracker

A React app that shows live aircraft within a radius of your current location, using the
free OpenSky Network API. Includes a small backend proxy — see "Why there's a backend"
below for why that's needed.

## How it works

1. Asks your browser for your current location (`navigator.geolocation`).
2. Builds a small bounding box around that point, sized to your chosen radius.
3. Calls our own backend, which fetches from OpenSky's `states/all` endpoint on the
   browser's behalf and returns the data.
4. Filters results down to a precise radius using the Haversine formula (the bounding
   box alone is only an approximation).
5. Displays a table: callsign, altitude, speed, distance from you, and an optional
   "Look up route" button per row.

## Route lookup now shows city names

OpenSky only ever returns an **ICAO airport code** (e.g. `KJFK`), never a city name.
`server/index.js` resolves these locally using a bundled lookup table
(`server/airports.json`) built from the [OurAirports](https://ourairports.com/data/)
public-domain dataset — 43,000+ airports mapped to city, full name, and country.
No extra API calls or rate-limit cost; it's a plain local file lookup. If an ICAO code
isn't in the dataset (rare — mostly very small/private airfields), it falls back to
showing "Unknown" for the city.

## Why there's a backend

OpenSky's API doesn't reliably send the `Access-Control-Allow-Origin` header browsers
require for cross-origin requests (this is a known, long-standing gap — see
https://github.com/openskynetwork/opensky-api/issues/34). Without it, browsers block
the response with a generic, unhelpful `Failed to fetch` error — no status code, no
detail, by design (browsers hide CORS failure details from JavaScript for security
reasons). When you don't control the remote server, the standard fix is to route the
request through a server you do control, which returns the data with proper CORS
headers for your own frontend. That's all `server/index.js` does here — it's a thin
pass-through, not a rewrite of any of the app's logic.

## Setup

You need **two terminals running at the same time** — one for the backend, one for the
frontend.

**Terminal 1 — backend:**
```bash
cd server
npm install
npm run dev
```
You should see `Flight tracker proxy server running on http://localhost:5000`.

**Terminal 2 — frontend:**
```bash
npm install
npm run dev
```
Open the URL Vite prints (usually `http://localhost:5173`). Allow location access when
your browser prompts you.

## Important limitations (read before you rely on this)

- **Source/Destination is best-effort, not guaranteed.** OpenSky's free tier doesn't
  include route info in the live position feed. This app looks it up separately via
  the `flights/aircraft` historical endpoint only when you click "Look up route" — and
  even then, it often returns "Unknown" for flights still in progress, since the arrival
  airport isn't known until landing (and sometimes the departure airport is missing too).
- **Anonymous rate limits.** OpenSky allows roughly 400 anonymous requests per day
  across *all* endpoints combined. Since refresh is now manual-only (no auto-polling),
  normal use should stay well within that, but heavy repeated clicking of "Refresh Now"
  and "Look up route" can still add up over a day.
- **Position data has some lag** — typically a few seconds up to a couple of minutes,
  depending on ADS-B coverage in your area. Rural areas may show very few or no aircraft
  even if flights are technically nearby, if there isn't good receiver coverage.
- **Requires HTTPS or localhost** for geolocation to work in most browsers — this is a
  browser security requirement, not something specific to this app.

## Increasing your rate limit (optional)

1. Create a free account at https://opensky-network.org
2. As of March 2025/2026, OpenSky requires the OAuth2 client-credentials flow for
   authenticated access (plain username/password is no longer supported) — this gets
   you 4,000 requests/day instead of 400.
3. Because this involves a client secret, do the OAuth token exchange in `server/index.js`
   (never in frontend code, where it would be exposed in the browser), then attach the
   resulting bearer token to the OpenSky requests the server makes. Happy to wire this up
   if you want the higher limit — it's a moderate change to the server file only.

## Deploying this for free (frontend + backend on separate services)

Since this app has both a frontend and a backend, they get deployed to two different
free services.

### Step 1: Deploy the backend to Render

1. Push this project to GitHub (if you haven't already).
2. Go to https://render.com, sign up free (no credit card required).
3. Click **New +** → **Web Service** → connect your GitHub repo.
4. Configure it:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Create Web Service**. Render will give you a URL like
   `https://flight-tracker-backend.onrender.com` — copy it.

**Known tradeoff:** Render's free tier spins the service down after 15 minutes of no
traffic. The next request after that wakes it back up, but takes roughly 30–60 seconds.
Totally fine for a personal project; just don't expect instant response after it's been
idle a while.

### Step 2: Deploy the frontend to Vercel or Netlify

1. Go to https://vercel.com (or https://netlify.com), sign up free, import the same
   GitHub repo.
2. **Root Directory:** leave as the project root (not `server`).
3. **Build Command:** `npm run build` — **Output Directory:** `dist` (Vercel/Netlify
   usually auto-detect this for a Vite project).
4. Add an environment variable:
   - **Name:** `VITE_API_URL`
   - **Value:** the Render backend URL from Step 1 (e.g.
     `https://flight-tracker-backend.onrender.com`, no trailing slash)
5. Deploy. You'll get a public URL like `https://flight-tracker.vercel.app`.

### Step 3: Verify

Open your deployed frontend URL, allow location access, and click "Refresh Now." If it
works locally but not here, double check the `VITE_API_URL` value has no typo and no
trailing slash, and that the Render service shows as "Live" in its dashboard (not still
building or crashed — check its logs tab if so).

## Possible next steps

- Add a live map view (e.g. with Leaflet or Mapbox) showing aircraft positions visually,
  not just in a table.
- Add airline/aircraft-type lookup by ICAO24 hex code using a free aircraft database.
- Add authenticated OpenSky access (see above) for a 10x higher rate limit.
- Add simple server-side caching (e.g. cache the last response for ~10-15 seconds) so
  multiple browser tabs/users don't each burn a separate OpenSky request for the same data.
