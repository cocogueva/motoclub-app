// Road routing for planned ride routes.
// POC: public OSRM demo server (free, no key, best-effort; not for heavy use).
// To switch provider (OpenRouteService, GraphHopper...), only change this file:
// keep the return shape { coords: [[lat, lng], ...], distance (m), duration (s) }.

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

export async function fetchRoute(points) {
  if (points.length < 2) throw new Error("Se necesitan al menos 2 puntos");

  // OSRM expects "lng,lat;lng,lat"
  const path = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const res = await fetch(`${OSRM_URL}/${path}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error("No se pudo calcular la ruta");

  const data = await res.json();
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) throw new Error("No se encontró una ruta");

  return {
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance,
    duration: route.duration,
  };
}

// Deep link to navigate with Waze (voice turn-by-turn) to a point
export function wazeLink({ lat, lng }) {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}

// Google Maps turn-by-turn through the planned stops, in order.
// No origin on purpose: Google then starts from "my location" and goes straight
// into navigation (with an explicit origin it only shows a preview). The start
// point is added as the first stop only when we're far from it (e.g. at home).
const GOOGLE_MAX_WAYPOINTS = 9; // Google Maps URL limit
export function googleMapsLink(stops, here = null) {
  let points = stops;
  if (here && points.length > 1 && distanceMeters(here, points[0]) < 500) {
    points = points.slice(1);
  }
  const destination = points[points.length - 1];
  const waypoints = points.slice(0, -1).slice(-GOOGLE_MAX_WAYPOINTS);
  const fmt = (p) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    api: "1",
    destination: fmt(destination),
    travelmode: "driving",
    dir_action: "navigate",
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

// Fetch failures (no signal / offline) come as TypeErrors with browser-specific text
export function isNetworkError(err) {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(
    err?.message || ""
  );
}

// Distance in meters between two {lat, lng} points (haversine)
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
