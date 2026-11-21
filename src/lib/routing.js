// Road routing for planned ride routes.
// POC: public OSRM demo server (free, no key, best-effort; not for heavy use).
// To switch provider (OpenRouteService, GraphHopper...), only change this file:
// keep the return shape { coords: [[lat, lng], ...], distance (m), duration (s), via }.

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

export async function fetchRoute(points) {
  if (points.length < 2) throw new Error("Se necesitan al menos 2 puntos");

  // OSRM expects "lng,lat;lng,lat"
  const path = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const res = await fetch(`${OSRM_URL}/${path}?overview=full&geometries=geojson&steps=true`);
  if (!res.ok) throw new Error("No se pudo calcular la ruta");

  const data = await res.json();
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) throw new Error("No se encontró una ruta");

  return {
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance,
    duration: route.duration,
    via: mainRoads(route),
  };
}

// "Carretera Panamericana Sur, Vía Expresa Sur": the 2 roads with the most km
function mainRoads(route) {
  const km = {};
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const name = step.name || step.ref;
      if (name) km[name] = (km[name] || 0) + step.distance;
    }
  }
  return Object.entries(km)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
    .join(", ");
}

// Non-breaking spaces so "41 min" never splits across lines
const NBSP = "\u00a0";
export const formatKm = (m) => `${(m / 1000).toFixed(1)}${NBSP}km`;
export function formatDuration(s) {
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return h ? `${h}${NBSP}h ${min}${NBSP}min` : `${min}${NBSP}min`;
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

// Compass bearing in degrees (0 = north, 90 = east) going from a to b
export function bearingDegrees(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
