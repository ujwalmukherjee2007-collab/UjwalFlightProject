# Nearby Flights Tracker

A React app that shows live aircraft within a radius of your current location, using
free, open flight-tracking APIs. Includes a small backend proxy — see "Why there's a
backend" for why that's needed.

## How it works

1. Asks your browser for your current location (`navigator.geolocation`).
2. Calls our own backend with your location and chosen radius.
3. The backend queries **adsb.lol** for live aircraft within that radius and returns
   the data with CORS enabled for our frontend.
4. Filters results down to a precise radius using the Haversine formula.
5. Displays a table: callsign, altitude, speed, direction, distance from you, and an
   optional "Look up route" button per row.

## Why adsb.lol instead of OpenSky

This project originally used the OpenSky Network API. That broke when deployed to a
cloud host (Render): OpenSky's own documentation states **"We may block AWS and other
hyperscalers due to generalized abuse from these IPs"** — and most free hosting
providers (Render, Vercel, Railway, etc.) run on exactly those hyperscalers. Locally
this worked fine (a home IP isn't blocked), but it broke the moment the backend was
deployed anywhere.

**adsb.lol** is a free, community-run, open ADS-B aggregator explicitly built for
public/programmatic use, with no such block — see https://www.adsb.lol/. No API key
is required.

## Route lookups via adsbdb.com

**adsbdb.com** (https://www.adsbdb.com/) is a free, open API that maps a flight's
**callsign** to its scheduled route — origin and destination airport, including city
names. Unlike OpenSky's historical-only route data, this works for flights **still in
the air**, since it looks up the route associated with the callsign directly rather
than waiting for the flight to land. Not every callsign has a route on file, and
aircraft not broadcasting a callsign at all can't be looked up — both cases show
"Unknown" or a "No callsign" note in the UI rather than failing silently.

## Why there's a backend

Beyond avoiding the hyperscaler block above, a backend proxy also sidesteps CORS
issues generally — some public APIs (OpenSky included) don't send the
`Access-Control-Allow-Origin` header browsers require for direct cross-origin
requests, which shows up as an opaque `Failed to fetch` error with no useful detail.
Routing requests through your own server avoids this regardless of which upstream
API you use.

## Setup

You need **two terminals running at the same time** — one for the backend, one for
the frontend.

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
Open the URL Vite prints (usually `http://localhost:5173`). Allow location access
when your browser prompts you.

## Important limitations (read before you rely on this)

- **Coverage depends on volunteer receivers.** adsb.lol (like OpenSky) relies on a
  global network of community-run ADS-B receivers. Dense in well-covered areas
  (major cities, airports), sparser in rural areas or over water.
- **Not every flight has a route on file.** adsbdb's route database doesn't cover
  every callsign, especially smaller/private/military flights.
- **Rate limits are dynamic, not a fixed daily number** — adsb.lol scales limits
  based on server load rather than a hard quota. A `429` response means back off
  and retry shortly.
- **Position data has some lag** — typically a few seconds up to a couple of
  minutes, depending on ADS-B coverage in your area.
- **Requires HTTPS or localhost** for geolocation to work in most browsers — this
  is a browser security requirement, not something specific to this app.

## Deploying this for free (frontend + backend on separate services)

Since this app has both a frontend and a backend, they get deployed to two
different free services.

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
traffic. The next request after that wakes it back up, but takes roughly 30–60
seconds. Totally fine for a personal project.

### Step 2: Deploy the frontend to Vercel or Netlify

1. Go to https://vercel.com (or https://netlify.com), sign up free, import the same
   GitHub repo.
2. **Root Directory:** leave as the project root (not `server`).
3. **Build Command:** `npm run build` — **Output Directory:** `dist` (usually
   auto-detected for a Vite project).
4. Add an environment variable:
   - **Name:** `VITE_API_URL`
   - **Value:** the Render backend URL from Step 1 (no trailing slash)
5. Deploy. You'll get a public URL like `https://flight-tracker.vercel.app`.

### Step 3: Verify

Open your deployed frontend URL, allow location access, and click "Refresh Now." If
it works locally but not here, double check the `VITE_API_URL` value has no typo and
no trailing slash, and that the Render service shows as "Live" in its dashboard.

## Possible next steps

- Add a live map view (e.g. with Leaflet or Mapbox) showing aircraft positions
  visually, not just in a table.
- Add aircraft-type/registration lookup using adsb.lol's `t` (type) and `r`
  (registration) fields, already returned but not yet shown.
- Add simple server-side caching (e.g. cache the last response for ~10-15 seconds)
  so multiple browser tabs/users don't each trigger a separate upstream request for
  the same data.
