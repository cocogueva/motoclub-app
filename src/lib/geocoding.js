// Place search (text → coordinates) and reverse lookup (coordinates → name).
// POC: Photon by komoot (https://photon.komoot.io): free, no key, OSM data,
// built for search-as-you-type. Best-effort public service; to switch provider
// (MapTiler, Google Places...) only change this file, keeping the return shape
// { lat, lng, name, detail }.

const PHOTON_URL = "https://photon.komoot.io";

// "Plaza de Armas" + "Cercado de Lima, Lima" from Photon's GeoJSON properties
function describe(props) {
  const street = [props.street, props.housenumber].filter(Boolean).join(" ");
  const name = props.name || street || props.district || props.city || "Lugar sin nombre";
  const detail = [
    props.name && street,
    props.district || props.locality,
    props.city !== props.name && props.city,
    props.state,
  ]
    .filter(Boolean)
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(", ");
  return { name, detail };
}

const toPlace = (feature) => {
  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng, ...describe(feature.properties || {}) };
};

/**
 * Search places by text, biased towards `near` ({lat, lng}, e.g. my position).
 * Pass an AbortSignal to cancel when the user keeps typing.
 */
export async function searchPlaces(query, near, signal) {
  const params = new URLSearchParams({ q: query, limit: "6" });
  if (near) {
    params.set("lat", near.lat.toFixed(4));
    params.set("lon", near.lng.toFixed(4));
  }
  const res = await fetch(`${PHOTON_URL}/api/?${params}`, { signal });
  if (!res.ok) throw new Error("No se pudo buscar el lugar");
  const data = await res.json();
  return (data.features || []).map(toPlace);
}

/** Name of the place at a point (for taps on the map). Null when unknown. */
export async function reverseGeocode({ lat, lng }) {
  try {
    const res = await fetch(`${PHOTON_URL}/reverse?lat=${lat}&lon=${lng}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0] ? toPlace(data.features[0]) : null;
  } catch {
    return null;
  }
}
