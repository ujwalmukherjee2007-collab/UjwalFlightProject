const EARTH_RADIUS_MILES = 3958.8;

// Haversine distance between two lat/lon points, in miles.
export function distanceInMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

// Rough bounding box (lamin, lomin, lamax, lomax) around a point for a given radius in miles.
// This is intentionally a bit generous — we filter precisely with distanceInMiles afterward.
export function boundingBox(lat, lon, radiusMiles) {
  const latDelta = radiusMiles / 69; // ~69 miles per degree latitude
  const lonDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180) || 1);

  return {
    lamin: lat - latDelta,
    lamax: lat + latDelta,
    lomin: lon - lonDelta,
    lomax: lon + lonDelta
  };
}

export function metersToFeet(meters) {
  if (meters === null || meters === undefined) return null;
  return Math.round(meters * 3.28084);
}

// Converts a compass heading in degrees (0-360, where 0/360 = North, 90 = East, etc.)
// into a 16-point compass label like "NE" or "SSW". OpenSky calls this field
// "true_track" — it's the aircraft's direction of travel over the ground, not the
// direction the nose is physically pointed (which can differ slightly in windy
// conditions), but for a flight tracker "which way is it heading" this is exactly
// the right field.
const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW'
];

export function headingToCompass(degrees) {
  if (degrees === null || degrees === undefined) return null;
  const normalized = ((degrees % 360) + 360) % 360; // handle negative/out-of-range values
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_POINTS[index];
}
