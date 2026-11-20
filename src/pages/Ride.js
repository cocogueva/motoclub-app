import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../supabaseClient";
import useRideTracking from "../hooks/useRideTracking";
import { fetchRoute, googleMapsLink, isNetworkError, wazeLink } from "../lib/routing";
import "./Ride.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LIMA = [-12.0464, -77.0428];

// Standard OpenStreetMap tiles: free, no key (fine for low club usage; CARTO
// now requires an API key). Dark mode = same tiles darkened with a CSS filter
// (.ride-tiles-dark in Ride.css), so there's only one provider to worry about.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const ROLES = {
  lead: { label: "Cap de Ruta", icon: "🧭" },
  rider: { label: "Rider", icon: "🏍️" },
  sweep: { label: "Barredor", icon: "🛡️" },
};
const ROLE_ORDER = { lead: 0, rider: 1, sweep: 2 }; // formation: front → back

const STALE_DIM_S = 60; // > 1 min: dimmed
const STALE_LOST_S = 300; // > 5 min: "sin señal"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const ageSeconds = (date) =>
  date ? Math.max(0, (Date.now() - new Date(date).getTime()) / 1000) : null;

const staleness = (age) =>
  age == null ? "lost" : age > STALE_LOST_S ? "lost" : age > STALE_DIM_S ? "dim" : "fresh";

const timeAgo = (age) => {
  if (age == null) return "sin ubicación";
  if (age < 15) return "ahora";
  if (age < 60) return `hace ${Math.round(age)} s`;
  if (age < 3600) return `hace ${Math.round(age / 60)} min`;
  return `hace ${Math.round(age / 3600)} h`;
};

const formatKm = (m) => `${(m / 1000).toFixed(1)} km`;
const formatDuration = (s) => {
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
};

// Map marker for a rider: photo (or initial), role badge, apodo label
const iconCache = new Map();
function riderIcon({ apodo, foto, role, stale, isMe, preview = false }) {
  const key = [apodo, foto, role, stale, isMe, preview].join("|");
  if (iconCache.has(key)) return iconCache.get(key);

  const avatar = foto
    ? `<img src="${escapeHtml(foto)}" alt="" />`
    : `<span class="rider-pin-initial">${escapeHtml((apodo || "?").charAt(0).toUpperCase())}</span>`;
  const badge = role !== "rider" ? `<span class="rider-pin-role">${ROLES[role].icon}</span>` : "";
  const classes = ["rider-pin", `role-${role}`, stale, isMe && "is-me", preview && "is-preview"]
    .filter(Boolean)
    .join(" ");

  const icon = L.divIcon({
    className: "rider-marker",
    html: `<div class="${classes}">
             <div class="rider-pin-avatar">${avatar}${badge}</div>
             <div class="rider-pin-name">${escapeHtml(apodo)}</div>
           </div>`,
    iconSize: [60, 72],
    iconAnchor: [30, 24],
  });
  iconCache.set(key, icon);
  return icon;
}

const flagIcon = (emoji) =>
  L.divIcon({
    className: "rider-marker",
    html: `<div class="route-flag">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [6, 30],
  });
const START_ICON = flagIcon("🚩");
const END_ICON = flagIcon("🏁");
const WAYPOINT_ICON = flagIcon("📍");

// Light/dark map following the phone (auto), or forced by the user
function useMapTheme() {
  const query = "(prefers-color-scheme: dark)";
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem("rideMapTheme") || "auto";
    } catch {
      return "auto";
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.(query).matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const cycle = () => {
    const next = { auto: "light", light: "dark", dark: "auto" }[mode];
    setMode(next);
    try {
      localStorage.setItem("rideMapTheme", next);
    } catch {
      /* private mode: just don't remember */
    }
  };

  return { mode, theme: mode === "auto" ? (systemDark ? "dark" : "light") : mode, cycle };
}

// ---------------------------------------------------------------------------
// Map helpers (must live inside <MapContainer>)
// ---------------------------------------------------------------------------
function FitToRide({ rideId, points }) {
  const map = useMap();
  const [fittedFor, setFittedFor] = useState(null);

  useEffect(() => {
    if (!rideId || fittedFor === rideId || points.length === 0) return;
    setFittedFor(rideId);
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [40, 40] });
  }, [rideId, points, map, fittedFor]);

  return null;
}

function PlanClicks({ enabled, onAdd }) {
  useMapEvents({
    click(e) {
      if (enabled) onAdd({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// "Seguirme": keep my position centered; dragging the map turns it off
function FollowMe({ enabled, position, onUserMove }) {
  const map = useMap();
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (enabled && position) map.panTo([position.lat, position.lng], { animate: true });
  }, [enabled, position, map]);
  return null;
}

// Ride mode toggles the map between inline and full screen: Leaflet must re-measure
function InvalidateOnResize({ trigger }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(id);
  }, [trigger, map]);
  return null;
}

const riderStatusText = (r) =>
  r.stale === "paused"
    ? "⏸️ pausado"
    : r.stale === "lost" && r.age != null
      ? "📵 sin señal"
      : timeAgo(r.age);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function Ride() {
  const [me, setMe] = useState(null);
  const [ride, setRide] = useState(null);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newRideName, setNewRideName] = useState("");
  const [joinRole, setJoinRole] = useState("rider");
  const [map, setMap] = useState(null);
  const [, setTick] = useState(0);
  const [connLost, setConnLost] = useState(false); // background refresh failed (no signal)
  const [rideMode, setRideMode] = useState(false); // full-screen map while riding
  const [follow, setFollow] = useState(false);

  // Route planning
  const [planning, setPlanning] = useState(false);
  const [planPoints, setPlanPoints] = useState([]);
  const [planRoute, setPlanRoute] = useState(null);

  const mapTheme = useMapTheme();

  // ---------- Data ----------
  const loadRide = useCallback(async () => {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    setRide(data);
    return data;
  }, []);

  const loadRiders = useCallback(async (rideId) => {
    if (!rideId) return setRiders([]);
    const { data, error } = await supabase
      .from("ride_locations")
      .select("*, member:members(id, apodo, nombre, foto, puesto)")
      .eq("ride_id", rideId);
    if (error) throw error;
    setRiders(data || []);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await loadRide();
      await loadRiders(current?.id);
      setConnLost(false);
    } catch (e) {
      // no signal is expected on the road: show a self-clearing notice, not an error
      if (isNetworkError(e)) setConnLost(true);
      else setMessage({ type: "warning", text: e.message });
    }
  }, [loadRide, loadRiders]);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data: member } = await supabase
          .from("members")
          .select("id, apodo, nombre, foto, puesto")
          .eq("email", user.email)
          .single();
        setMe(member);
        setJoinRole(member?.puesto === "Cap de Ruta" ? "lead" : "rider");
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  // Live updates: Realtime + 30 s polling fallback
  useEffect(() => {
    let timer;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    const channel = supabase
      .channel("ride-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_locations" }, debounced)
      .subscribe();
    const poll = setInterval(refresh, 30_000);
    // signal back / app back on screen: catch up right away
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Re-render every 15 s so "hace X min" and fading stay current
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // ---------- Derived ----------
  const myRow = riders.find((r) => r.member_id === me?.id);
  const joined = Boolean(ride && myRow);
  const tracking = useRideTracking(ride?.id, joined);

  const canManage = Boolean(
    me &&
      ride &&
      (ride.created_by === me.id ||
        ["Presidente", "Cap de Ruta"].includes(me.puesto) ||
        myRow?.role === "lead")
  );

  // My own marker uses the local GPS (instant); others come from the DB
  const displayRiders = useMemo(
    () =>
      riders
        .map((r) => {
          const isMe = r.member_id === me?.id;
          const local = isMe && tracking.position;
          const lat = local ? tracking.position.lat : r.lat;
          const lng = local ? tracking.position.lng : r.lng;
          const age = isMe && tracking.lastSentAt
            ? ageSeconds(tracking.lastSentAt)
            : r.lat != null
              ? ageSeconds(r.updated_at)
              : null;
          const stale = local
            ? "fresh"
            : !isMe && r.paused_at
              ? "paused"
              : staleness(age);
          return { ...r, isMe, lat, lng, age, stale };
        })
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]),
    [riders, me, tracking.position, tracking.lastSentAt]
  );

  const positioned = displayRiders.filter((r) => r.lat != null);
  const offline = connLost || tracking.offline;
  const stops = ride?.stops?.length
    ? ride.stops
    : [ride?.start_point, ride?.end_point].filter(Boolean);
  const googleUrl = stops.length ? googleMapsLink(stops, tracking.position) : null;
  const routeCoords = planning ? planRoute?.coords : ride?.route;
  const fitPoints = useMemo(
    () => [...(ride?.route || []), ...positioned.map((r) => [r.lat, r.lng])],
    // only used for the first fit per ride
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ride?.id, ride?.route, positioned.length]
  );

  // ---------- Actions ----------
  const run = async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (okText) setMessage({ type: "success", text: okText });
      await refresh();
    } catch (e) {
      setMessage({ type: "warning", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const rpc = async (name, args) => {
    const { error } = await supabase.rpc(name, args);
    if (error) throw error;
  };

  const createRide = (e) => {
    e.preventDefault();
    if (!newRideName.trim()) return;
    run(() => rpc("create_ride", { p_name: newRideName }), "Ride creado");
    setNewRideName("");
  };

  const join = (role = joinRole) =>
    run(() => rpc("join_ride", { p_ride_id: ride.id, p_role: role }));

  const leave = () => run(() => rpc("leave_ride", { p_ride_id: ride.id }));

  const endRide = () => {
    if (!window.confirm("¿Terminar el ride para todos?")) return;
    run(() => rpc("end_ride", { p_ride_id: ride.id }), "Ride terminado");
  };

  const startPlanning = () => {
    setPlanning(true);
    setPlanPoints([]);
    setPlanRoute(null);
    setMessage(null);
  };

  const cancelPlanning = () => {
    setPlanning(false);
    setPlanPoints([]);
    setPlanRoute(null);
  };

  const addPlanPoint = (p) => {
    setPlanPoints((pts) => [...pts, p]);
    setPlanRoute(null);
  };

  const undoPlanPoint = () => {
    setPlanPoints((pts) => pts.slice(0, -1));
    setPlanRoute(null);
  };

  const calculateRoute = () =>
    run(async () => setPlanRoute(await fetchRoute(planPoints)));

  const saveRoute = () =>
    run(async () => {
      await rpc("set_ride_route", {
        p_ride_id: ride.id,
        p_start: planPoints[0],
        p_end: planPoints[planPoints.length - 1],
        p_route: planRoute.coords,
        p_distance_m: Math.round(planRoute.distance),
        p_duration_s: Math.round(planRoute.duration),
        p_stops: planPoints,
      });
      cancelPlanning();
    }, "Ruta guardada");

  const centerOnMe = () => {
    if (map && tracking.position) map.setView([tracking.position.lat, tracking.position.lng], 16);
  };

  const toggleFollow = () => {
    if (!follow) centerOnMe();
    setFollow(!follow);
  };

  // Ride mode: map full screen, big buttons, follow me on. Real fullscreen where
  // the browser allows it (Android); iPhone just gets the full-viewport overlay.
  const enterRideMode = () => {
    setRideMode(true);
    setFollow(Boolean(tracking.position));
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exitRideMode = () => {
    setRideMode(false);
    setFollow(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  // Leaving browser fullscreen with the back gesture also leaves ride mode
  useEffect(() => {
    const onFs = () => !document.fullscreenElement && setRideMode(false);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Ride ended / not joined anymore: back to the normal page
  useEffect(() => {
    if (rideMode && !ride) exitRideMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride, rideMode]);

  const showEveryone = () => {
    const pts = [...(ride?.route || []), ...positioned.map((r) => [r.lat, r.lng])];
    if (!map || pts.length === 0) return;
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(pts, { padding: [40, 40] });
  };

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="ride-page">
      <div className="ride-header">
        <div>
          <h1 className="page-title">{ride ? ride.name : "Ride"}</h1>
          <p className="page-subtitle">
            {ride
              ? `${riders.length} en el ride` +
                (ride.route_distance_m
                  ? ` · ${formatKm(ride.route_distance_m)} · ~${formatDuration(ride.route_duration_s)}`
                  : "")
              : "Ubicación en vivo del grupo"}
          </p>
        </div>
        <span className="wip-tape">👷🚧 En construcción</span>
      </div>

      {message && <div className={`message message-${message.type}`}>{message.text}</div>}

      {/* No active ride: create one */}
      {!ride && (
        <form className="ride-panel ride-create" onSubmit={createRide}>
          <p className="ride-empty">No hay un ride activo.</p>
          <div className="ride-create-row">
            <input
              type="text"
              placeholder="Nombre (ej. Ride a Lunahuaná)"
              value={newRideName}
              onChange={(e) => setNewRideName(e.target.value)}
              maxLength={60}
            />
            <button className="btn" type="submit" disabled={busy || !newRideName.trim()}>
              Crear ride
            </button>
          </div>
        </form>
      )}

      {/* Active ride: join / leave / manage */}
      {ride && !planning && (
        <div className="ride-panel ride-actions">
          {!joined ? (
            <>
              <select value={joinRole} onChange={(e) => setJoinRole(e.target.value)}>
                {Object.entries(ROLES).map(([key, r]) => (
                  <option key={key} value={key}>
                    {r.icon} {r.label}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => join()} disabled={busy}>
                Unirse
              </button>
            </>
          ) : (
            <>
              <select
                value={myRow.role}
                onChange={(e) => join(e.target.value)}
                disabled={busy}
                aria-label="Mi rol"
              >
                {Object.entries(ROLES).map(([key, r]) => (
                  <option key={key} value={key}>
                    {r.icon} {r.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" onClick={leave} disabled={busy}>
                Salir
              </button>
            </>
          )}
          {joined && (
            <button className="btn" onClick={enterRideMode}>
              ⛶ Modo ride
            </button>
          )}
          {googleUrl && (
            <a className="btn btn-secondary" href={googleUrl} target="_blank" rel="noopener noreferrer">
              Google Maps ↗
            </a>
          )}
          {ride.end_point && (
            <a
              className="btn btn-secondary"
              href={wazeLink(ride.end_point)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Waze ↗
            </a>
          )}
          {canManage && (
            <>
              <button className="btn btn-secondary" onClick={startPlanning} disabled={busy}>
                {ride.route ? "Cambiar ruta" : "Trazar ruta"}
              </button>
              <button className="btn btn-danger" onClick={endRide} disabled={busy}>
                Terminar
              </button>
            </>
          )}
        </div>
      )}

      {/* Route planning */}
      {planning && (
        <div className="ride-panel ride-plan">
          <p className="ride-plan-hint">
            {planPoints.length === 0
              ? "Toca el mapa para marcar el punto de partida 🚩"
              : planPoints.length === 1
                ? "Ahora toca el destino 🏁 (puedes agregar paradas en orden)"
                : planRoute
                  ? `Ruta: ${formatKm(planRoute.distance)} · ~${formatDuration(planRoute.duration)}`
                  : `${planPoints.length} puntos. Calcula la ruta o sigue agregando paradas.`}
          </p>
          <div className="ride-plan-buttons">
            <button
              className="btn btn-secondary"
              onClick={undoPlanPoint}
              disabled={busy || planPoints.length === 0}
            >
              Deshacer
            </button>
            {!planRoute ? (
              <button className="btn" onClick={calculateRoute} disabled={busy || planPoints.length < 2}>
                Calcular ruta
              </button>
            ) : (
              <button className="btn" onClick={saveRoute} disabled={busy}>
                Guardar ruta
              </button>
            )}
            <button className="btn btn-secondary" onClick={cancelPlanning} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {offline && (
        <div className="ride-status has-error">
          <span>📵 Sin conexión: reintentando. Tu ubicación se enviará al recuperar señal.</span>
        </div>
      )}

      {/* Tracking status */}
      {joined && !offline && (
        <div className={`ride-status ${tracking.error ? "has-error" : ""}`}>
          {tracking.error ? (
            <span>⚠️ {tracking.error}</span>
          ) : (
            <>
              <span>
                📡 Compartiendo ubicación
                {tracking.lastSentAt && ` · enviada ${timeAgo(ageSeconds(tracking.lastSentAt))}`}
                {tracking.position?.accuracy != null &&
                  ` · ±${Math.round(tracking.position.accuracy)} m`}
              </span>
              <span>
                {tracking.wakeLock
                  ? "🔆 Pantalla siempre encendida"
                  : "⚠️ Mantén la app abierta: si cambias de app tu ubicación se detiene"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Map */}
      <div
        className={`ride-map-wrap ${planning ? "is-planning" : ""} ${rideMode ? "is-ride-mode" : ""}`}
      >
        <MapContainer center={LIMA} zoom={12} className="ride-map" ref={setMap}>
          <TileLayer
            key={mapTheme.theme}
            url={TILE_URL}
            attribution={ATTRIBUTION}
            maxZoom={19}
            className={mapTheme.theme === "dark" ? "ride-tiles-dark" : ""}
          />
          <FitToRide rideId={ride?.id} points={fitPoints} />
          <PlanClicks enabled={planning} onAdd={addPlanPoint} />
          <FollowMe enabled={follow} position={tracking.position} onUserMove={() => setFollow(false)} />
          <InvalidateOnResize trigger={rideMode} />

          {routeCoords && (
            <Polyline
              positions={routeCoords}
              pathOptions={{ className: "ride-route-line", weight: 5 }}
            />
          )}

          {planning
            ? planPoints.map((p, i) => (
                <Marker
                  key={`plan-${i}`}
                  position={[p.lat, p.lng]}
                  icon={i === 0 ? START_ICON : i === planPoints.length - 1 ? END_ICON : WAYPOINT_ICON}
                />
              ))
            : ride?.start_point && (
                <>
                  <Marker position={[ride.start_point.lat, ride.start_point.lng]} icon={START_ICON} />
                  <Marker position={[ride.end_point.lat, ride.end_point.lng]} icon={END_ICON} />
                </>
              )}

          {/* Not in the ride yet: my local position ("you are here", not shared) */}
          {!joined && me && tracking.position && (
            <Marker
              position={[tracking.position.lat, tracking.position.lng]}
              zIndexOffset={1000}
              title="Tu ubicación (no compartida hasta que te unas)"
              icon={riderIcon({
                apodo: "Tú",
                foto: me.foto,
                role: "rider",
                stale: "fresh",
                isMe: true,
                preview: true,
              })}
            />
          )}

          {positioned.map((r) => (
            <Marker
              key={r.member_id}
              position={[r.lat, r.lng]}
              zIndexOffset={r.isMe ? 1000 : ROLE_ORDER[r.role] === 1 ? 0 : 500}
              icon={riderIcon({
                apodo: r.member?.apodo || r.member?.nombre,
                foto: r.member?.foto,
                role: r.role,
                stale: r.stale,
                isMe: r.isMe,
              })}
            />
          ))}
        </MapContainer>

        {!rideMode && (
          <div className="ride-map-controls">
            <button onClick={mapTheme.cycle} title="Tema del mapa">
              {{ auto: "🌗 Auto", light: "☀️ Claro", dark: "🌙 Oscuro" }[mapTheme.mode]}
            </button>
            {positioned.length > 0 && <button onClick={showEveryone}>👥 Todos</button>}
            {tracking.position && <button onClick={centerOnMe}>📍 Yo</button>}
          </div>
        )}

        {rideMode && (
          <>
            {/* Top: ride name + my status, readable at a glance */}
            <div className={`ride-hud ${offline || tracking.error ? "has-error" : ""}`}>
              <strong>{ride?.name}</strong>
              <span>
                {tracking.error
                  ? `⚠️ ${tracking.error}`
                  : offline
                    ? "📵 Sin señal, reintentando"
                    : `📡 ${riders.length} en el ride` +
                      (tracking.lastSentAt ? ` · enviada ${timeAgo(ageSeconds(tracking.lastSentAt))}` : "")}
              </span>
            </div>

            {/* Bottom: big buttons (gloves) */}
            <div className="ride-mode-bar">
              <button onClick={showEveryone} disabled={positioned.length === 0}>
                <span>👥</span>Todos
              </button>
              <button
                onClick={toggleFollow}
                disabled={!tracking.position}
                className={follow ? "is-on" : ""}
              >
                <span>📍</span>Seguirme
              </button>
              {googleUrl && (
                <a href={googleUrl} target="_blank" rel="noopener noreferrer">
                  <span>🧭</span>Maps
                </a>
              )}
              <button onClick={mapTheme.cycle}>
                <span>{{ auto: "🌗", light: "☀️", dark: "🌙" }[mapTheme.mode]}</span>
                {{ auto: "Auto", light: "Claro", dark: "Oscuro" }[mapTheme.mode]}
              </button>
              <button onClick={exitRideMode}>
                <span>✕</span>Salir
              </button>
            </div>
          </>
        )}
      </div>

      {/* Riders list (formation order: lead → riders → sweep) */}
      {ride && (
        <div className="ride-riders">
          <h2 className="section-title">En el ride</h2>
          {displayRiders.length === 0 ? (
            <p className="ride-empty">Nadie se ha unido todavía.</p>
          ) : (
            displayRiders.map((r) => (
              <div key={r.member_id} className={`ride-rider ${r.stale}`}>
                <div className={`ride-rider-avatar role-${r.role}`}>
                  {r.member?.foto ? (
                    <img src={r.member.foto} alt="" />
                  ) : (
                    <span>{(r.member?.apodo || "?").charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="ride-rider-info">
                  <strong>
                    {r.member?.apodo || r.member?.nombre}
                    {r.isMe && " (tú)"}
                  </strong>
                  <span>
                    {ROLES[r.role].icon} {ROLES[r.role].label}
                  </span>
                </div>
                <div className="ride-rider-meta">
                  <span>{riderStatusText(r)}</span>
                  {r.speed != null && ["fresh", "dim"].includes(r.stale) && (
                    <span>{Math.round(r.speed * 3.6)} km/h</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default Ride;
