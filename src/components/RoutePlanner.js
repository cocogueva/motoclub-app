import React, { useEffect, useRef, useState } from "react";
import { reverseGeocode, searchPlaces } from "../lib/geocoding";
import { formatDuration, formatKm } from "../lib/routing";
import "./RoutePlanner.css";

// ---------------------------------------------------------------------------
// Plan points: [start, ...stops, destination], each { id, lat, lng, name, detail }
// ---------------------------------------------------------------------------
let nextId = 1;
export const makePlanPoint = ({ lat, lng, name, detail = "", mine = false }) => ({
  id: nextId++,
  lat,
  lng,
  name: name || "Punto en el mapa",
  detail,
  mine, // planner's own position: renamed to its street address (see useMyLocation)
});

// Like a navigation app: the first two points are start and destination; after
// that a new place is added as a stop just before the destination.
export const insertPlanPoint = (points, point) =>
  points.length < 2
    ? [...points, point]
    : [...points.slice(0, -1), point, points[points.length - 1]];

const pointIcon = (i, total) => (i === 0 ? "🚩" : i === total - 1 ? "🏁" : "📍");
const pointRole = (i, total) =>
  i === 0 ? "Salida" : i === total - 1 ? "Destino" : `Parada ${i}`;


// ---------------------------------------------------------------------------
// Search box with results as you type
// ---------------------------------------------------------------------------
function PlaceSearch({ near, onPick, placeholder }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchPlaces(q, near, ctrl.signal);
        setResults(found);
        setError(found.length ? null : "Sin resultados");
      } catch (e) {
        if (e.name !== "AbortError") setError("No se pudo buscar. Revisa tu conexión.");
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // `near` only biases results: don't search again every time the GPS moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pick = (place) => {
    onPick(place);
    setQuery("");
    setResults([]);
  };

  return (
    <div className="route-planner-search">
      <input
        type="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar lugar"
        enterKeyHint="search"
      />
      {searching && <span className="route-planner-searching">Buscando…</span>}
      {(results.length > 0 || error) && (
        <ul className="route-planner-results">
          {error && <li className="route-planner-empty">{error}</li>}
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button type="button" onClick={() => pick(r)}>
                <strong>{r.name}</strong>
                {r.detail && <span>{r.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planner panel
// ---------------------------------------------------------------------------
/**
 * Route editor: search places or tap the map (handled by the page), use my
 * location as the start, reorder / remove points. The page computes the road
 * route whenever the points change and passes it back as `route`.
 */
export default function RoutePlanner({
  points,
  onChange,
  route,
  routing,
  routeError,
  myPosition,
  busy,
  onSave,
  onCancel,
}) {
  const total = points.length;

  const addPlace = (place) => onChange(insertPlanPoint(points, makePlanPoint(place)));

  // "Mi ubicación" means something different for every rider, so the point is
  // renamed right away to its address (what the others will see once saved)
  const useMyLocation = async () => {
    const me = makePlanPoint({ ...myPosition, name: "Mi ubicación", mine: true });
    // replace a previous "my location" start instead of stacking them
    const rest = points[0]?.mine ? points.slice(1) : points;
    onChange([me, ...rest]);
    const place = await reverseGeocode(me);
    onChange((pts) =>
      pts.map((p) =>
        p.id === me.id
          ? { ...p, name: place?.name || "Punto de salida", detail: "Tu ubicación al planear" }
          : p
      )
    );
  };

  // Drag to reorder: grab the ⠿ handle and slide. Pointer events, so it works
  // with touch (native HTML drag & drop doesn't on phones). Reorders live; the
  // route recalculates once the points settle (debounced by the page).
  const listRef = useRef(null);
  const [dragId, setDragId] = useState(null);

  const onHandleDown = (e, id) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(id);
  };

  const onHandleMove = (e) => {
    if (dragId == null || !listRef.current) return;
    const rows = [...listRef.current.children];
    const from = points.findIndex((p) => p.id === dragId);
    let to = rows.findIndex((row) => {
      const b = row.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    });
    if (to === -1) to = rows.length - 1;
    else if (to > from) to -= 1;
    if (from === -1 || to === from) return;
    const next = [...points];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const onHandleUp = () => setDragId(null);

  const remove = (i) => onChange(points.filter((_, k) => k !== i));

  const hint =
    total === 0
      ? "Busca un lugar o toca el mapa para marcar la salida 🚩"
      : total === 1
        ? "Ahora el destino 🏁: búscalo o tócalo en el mapa"
        : routing
          ? "Calculando ruta…"
          : routeError
            ? `⚠️ ${routeError}`
            : route
              ? `Ruta: ${formatKm(route.distance)} · ~${formatDuration(route.duration)}` +
                (route.via ? ` · por ${route.via}` : "")
              : "";

  return (
    <div className="ride-panel route-planner">
      <PlaceSearch
        near={myPosition || points[total - 1]}
        onPick={addPlace}
        placeholder={
          total === 0
            ? "Salida: busca un lugar…"
            : total === 1
              ? "Destino: ej. Plaza de Armas de Lima"
              : "Agregar parada antes del destino…"
        }
      />

      {myPosition && (
        <button type="button" className="route-planner-mine" onClick={useMyLocation}>
          📍 Salir desde mi ubicación
        </button>
      )}

      {total > 0 && (
        <ol className="route-planner-points" ref={listRef}>
          {points.map((p, i) => (
            <li key={p.id} className={p.id === dragId ? "is-dragging" : ""}>
              {total > 1 && (
                <span
                  className="route-planner-handle"
                  onPointerDown={(e) => onHandleDown(e, p.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  role="button"
                  aria-label="Arrastrar para reordenar"
                  title="Arrastrar para reordenar"
                >
                  ⠿
                </span>
              )}
              <span className="route-planner-icon">{pointIcon(i, total)}</span>
              <div className="route-planner-name">
                <small>{pointRole(i, total)}</small>
                <strong>{p.name}</strong>
                {p.detail && <span>{p.detail}</span>}
              </div>
              <button
                type="button"
                className="route-planner-remove"
                onClick={() => remove(i)}
                aria-label="Quitar"
                title="Quitar"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      <p className="ride-plan-hint">{hint}</p>

      <div className="ride-plan-buttons">
        <button className="btn" onClick={onSave} disabled={busy || routing || !route || total < 2}>
          Guardar ruta
        </button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>

      <p className="route-planner-credit">Búsqueda: Photon · © OpenStreetMap</p>
    </div>
  );
}
