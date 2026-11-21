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
import "leaflet-rotate"; // adds map rotation (setBearing) for the "Rumbo" mode
import "leaflet/dist/leaflet.css";
import { supabase } from "../supabaseClient";
import useRideTracking from "../hooks/useRideTracking";
import RoutePlanner, { insertPlanPoint, makePlanPoint } from "../components/RoutePlanner";
import { reverseGeocode } from "../lib/geocoding";
import {
  AutoThemeIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  GoogleMapsIcon,
  GroupIcon,
  LocateIcon,
  MoonIcon,
  MoreIcon,
  PencilIcon,
  NavigationIcon,
  SunIcon,
  WazeIcon,
} from "../components/Icons";
import {
  fetchRoute,
  formatDuration,
  formatKm,
  googleMapsLink,
  isNetworkError,
  wazeLink,
} from "../lib/routing";
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
  sweep: { label: "Colero", icon: "🛡️" },
};
const ROLE_ORDER = { lead: 0, rider: 1, sweep: 2 }; // formation: front → back

// Follow button, same cycle as a navigation app's location button:
// off → north (centered on me) → heading (centered, map turns with me) → off.
// "heading-free" = dragged the map while in heading: stays rotated, stops
// centering; tapping goes back to heading.
const FOLLOW_NEXT = { off: "north", north: "heading", heading: "off", "heading-free": "heading" };
// Icon + tooltip per follow state (Rumbo = map turns so my direction points up)
const FOLLOW_UI = {
  off: { title: "Seguirme", icon: <LocateIcon /> },
  north: { title: "Siguiéndote (norte arriba). Toca para Rumbo", icon: <LocateIcon active /> },
  heading: { title: "Rumbo: el mapa gira con tu dirección", icon: <NavigationIcon /> },
};
const THEME_UI = {
  auto: { title: "Tema del mapa: automático", icon: <AutoThemeIcon /> },
  light: { title: "Tema del mapa: claro", icon: <SunIcon /> },
  dark: { title: "Tema del mapa: oscuro", icon: <MoonIcon /> },
};

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


// Map marker for a rider: photo (or initial), role badge, apodo label
const iconCache = new Map();
// heading = direction of travel (0 = north); bearing = current map rotation.
// Markers stay upright when the map rotates, so the arrow adds both.
function riderIcon({ apodo, foto, role, stale, isMe, preview = false, heading = null, bearing = 0 }) {
  const arrow = heading == null ? null : Math.round(((heading + bearing) % 360) / 5) * 5;
  const key = [apodo, foto, role, stale, isMe, preview, arrow].join("|");
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
             <div class="rider-pin-avatar">${
               arrow == null
                 ? ""
                 : `<div class="rider-pin-heading" style="transform: rotate(${arrow}deg)"></div>`
             }${avatar}${badge}</div>
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

// Map rotation: "heading" turns the map so my direction of travel points up
// (like a navigation app), anything else = north up. Reports the bearing so the
// marker arrows can compensate.
function RotateMap({ headingUp, heading, onBearing }) {
  const map = useMap();
  useEffect(() => {
    const report = () => onBearing(map.getBearing());
    map.on("rotate", report);
    return () => map.off("rotate", report);
  }, [map, onBearing]);
  useEffect(() => {
    const target = headingUp && heading != null ? (360 - heading) % 360 : 0;
    const diff = Math.abs(((map.getBearing() - target + 540) % 360) - 180);
    if (diff >= 4) map.setBearing(target); // ignore GPS jitter
  }, [headingUp, heading, map]);
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
  // follow: see FOLLOW_NEXT
  const [follow, setFollow] = useState("off");
  const [menuOpen, setMenuOpen] = useState(false); // "⋯" (Terminar ride)
  const [mapBearing, setMapBearing] = useState(0);

  // Route planning
  const [planning, setPlanning] = useState(false);
  const [planPoints, setPlanPoints] = useState([]);
  const [planRoute, setPlanRoute] = useState(null);
  const [planRouting, setPlanRouting] = useState(false);
  const [planRouteError, setPlanRouteError] = useState(null);

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
  const problem = offline
    ? "📵 Sin conexión: reintentando. Tu ubicación se enviará al recuperar señal."
    : joined && tracking.error
      ? `⚠️ ${tracking.error}`
      : joined && !("wakeLock" in navigator)
        ? "⚠️ Este navegador no mantiene la pantalla encendida: no cambies de app ni bloquees el teléfono."
        : null;
  const mySpeedKmh =
    tracking.position?.speed != null ? Math.round(tracking.position.speed * 3.6) : null;
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

  // Joining goes straight to ride mode (closable to see the rest); changing role doesn't
  const join = (role = joinRole) =>
    run(async () => {
      await rpc("join_ride", { p_ride_id: ride.id, p_role: role });
      if (!joined) enterRideMode();
    });

  const leave = () => run(() => rpc("leave_ride", { p_ride_id: ride.id }));

  const endRide = () => {
    setMenuOpen(false);
    if (!window.confirm("¿Terminar el ride para todos?")) return;
    run(() => rpc("end_ride", { p_ride_id: ride.id }), "Ride terminado");
  };

  // "Trazar / Cambiar ruta" starts from the saved route, so a stop can be added to it
  const startPlanning = () => {
    const saved = ride?.stops?.length
      ? ride.stops
      : [ride?.start_point, ride?.end_point].filter(Boolean);
    setPlanPoints(
      saved.map((p, i, all) =>
        makePlanPoint({
          ...p,
          name: p.name || (i === 0 ? "Salida" : i === all.length - 1 ? "Destino" : `Parada ${i}`),
        })
      )
    );
    setPlanRoute(null);
    setPlanning(true);
    setMessage(null);
  };

  const cancelPlanning = () => {
    setPlanning(false);
    setPlanPoints([]);
    setPlanRoute(null);
    setPlanRouteError(null);
  };

  // Tap on the map: add the point right away, then name it (reverse lookup)
  const addPlanPoint = async ({ lat, lng }) => {
    const point = makePlanPoint({ lat, lng });
    setPlanPoints((pts) => insertPlanPoint(pts, point));
    const place = await reverseGeocode(point);
    if (place) {
      setPlanPoints((pts) =>
        pts.map((p) => (p.id === point.id ? { ...p, name: place.name, detail: place.detail } : p))
      );
    }
  };

  // Road route recalculated whenever the points (positions/order) change
  const planKey = planPoints.map((p) => `${p.lat},${p.lng}`).join(";");
  useEffect(() => {
    if (!planning) return;
    setPlanRouteError(null);
    if (planPoints.length < 2) {
      setPlanRoute(null);
      return;
    }
    let cancelled = false;
    setPlanRouting(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetchRoute(planPoints);
        if (!cancelled) setPlanRoute(r);
      } catch (e) {
        if (!cancelled) {
          setPlanRoute(null);
          setPlanRouteError(e.message);
        }
      } finally {
        if (!cancelled) setPlanRouting(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPlanRouting(false);
    };
    // planKey covers planPoints' positions; names changing must not re-route
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning, planKey]);

  // A searched place can be far away: bring all plan points into view (only
  // when one is off screen, so taps on the map don't make it jump)
  useEffect(() => {
    if (!planning || !map || planPoints.length === 0) return;
    const latlngs = planPoints.map((p) => [p.lat, p.lng]);
    const bounds = map.getBounds();
    if (latlngs.every((ll) => bounds.contains(ll))) return;
    if (latlngs.length === 1) map.setView(latlngs[0], 15);
    else map.fitBounds(latlngs, { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning, planKey, map]);

  const saveRoute = () =>
    run(async () => {
      await rpc("set_ride_route", {
        p_ride_id: ride.id,
        p_start: { lat: planPoints[0].lat, lng: planPoints[0].lng },
        p_end: { lat: planPoints[planPoints.length - 1].lat, lng: planPoints[planPoints.length - 1].lng },
        p_route: planRoute.coords,
        p_distance_m: Math.round(planRoute.distance),
        p_duration_s: Math.round(planRoute.duration),
        // "Mi ubicación" would read as each rider's own position: never save it
        p_stops: planPoints.map(({ lat, lng, name, mine }) => ({
          lat,
          lng,
          name: mine && name === "Mi ubicación" ? "Punto de salida" : name,
        })),
      });
      cancelPlanning();
    }, "Ruta guardada");

  const centerOnMe = () => {
    if (map && tracking.position) map.setView([tracking.position.lat, tracking.position.lng], 16);
  };

  const cycleFollow = () => {
    const next = FOLLOW_NEXT[follow];
    if (next !== "off") centerOnMe();
    setFollow(next);
  };
  const followMode = follow === "heading-free" ? "off" : follow; // for labels

  // Ride mode: map full screen, big buttons, follow me on. Real fullscreen where
  // the browser allows it (Android); iPhone just gets the full-viewport overlay.
  const enterRideMode = () => {
    setRideMode(true);
    setFollow(tracking.position ? "heading" : "off");
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exitRideMode = () => {
    setRideMode(false);
    setFollow("off");
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
    setFollow("off"); // overview: stop following, back to north up
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
        <span className="wip-tape">👷🚧 En construcción</span>
        <h1 className="page-title">{ride ? ride.name : "Ride"}</h1>
        <p className="page-subtitle">
          {ride
            ? riders.length === 0
              ? "Nadie en el ride todavía"
              : `${riders.length} en el ride`
            : "Ubicación en vivo del grupo"}
        </p>
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

      {/* Route card: stops, km/time, edit (managers), open in a nav app (optional) */}
      {ride && !planning && (
        <div className="ride-route-card">
          <div className="ride-route-info">
            {stops.length > 0 ? (
              <>
                <p className="ride-stops">
                  {stops.map((p, i) => (
                    <span key={i}>
                      {i === 0 ? "🚩" : i === stops.length - 1 ? "🏁" : "📍"}{" "}
                      {p.name || (i === 0 ? "Salida" : i === stops.length - 1 ? "Destino" : "Parada")}
                    </span>
                  ))}
                </p>
                {ride.route_distance_m && (
                  <p className="ride-route-meta">
                    {formatKm(ride.route_distance_m)} · ~{formatDuration(ride.route_duration_s)}
                  </p>
                )}
              </>
            ) : (
              <p className="ride-empty">Sin ruta todavía.</p>
            )}
          </div>

          <div className="ride-route-tools">
            {googleUrl && (
              <>
                <span className="ride-nav-label">Abrir en</span>
                <a
                  className="ride-nav-app"
                  href={googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Navegar con Google Maps (con todas las paradas)"
                  aria-label="Abrir en Google Maps"
                >
                  <GoogleMapsIcon size={20} />
                </a>
                <a
                  className="ride-nav-app"
                  href={wazeLink(stops[stops.length - 1])}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Navegar con Waze (solo al destino)"
                  aria-label="Abrir en Waze"
                >
                  <WazeIcon size={20} />
                </a>
              </>
            )}
            {canManage &&
              (ride.route ? (
                <button
                  className="ride-icon-btn"
                  onClick={startPlanning}
                  disabled={busy}
                  title="Modificar ruta"
                  aria-label="Modificar ruta"
                >
                  <PencilIcon size={18} />
                </button>
              ) : (
                <button className="btn btn-secondary ride-small-btn" onClick={startPlanning} disabled={busy}>
                  <PencilIcon size={16} /> Trazar ruta
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Route planning */}
      {planning && (
        <RoutePlanner
          points={planPoints}
          onChange={setPlanPoints}
          route={planRoute}
          routing={planRouting}
          routeError={planRouteError}
          myPosition={tracking.position}
          busy={busy}
          onSave={saveRoute}
          onCancel={cancelPlanning}
        />
      )}

      {/* Map */}
      <div
        className={`ride-map-wrap ${planning ? "is-planning" : ""} ${rideMode ? "is-ride-mode" : ""}`}
      >
        <MapContainer
          center={LIMA}
          zoom={12}
          className="ride-map"
          ref={setMap}
          rotate
          bearing={0}
          rotateControl={false}
          touchRotate={false}
        >
          <TileLayer
            key={mapTheme.theme}
            url={TILE_URL}
            attribution={ATTRIBUTION}
            maxZoom={19}
            className={mapTheme.theme === "dark" ? "ride-tiles-dark" : ""}
          />
          <FitToRide rideId={ride?.id} points={fitPoints} />
          <PlanClicks enabled={planning} onAdd={addPlanPoint} />
          <FollowMe
            enabled={follow === "north" || follow === "heading"}
            position={tracking.position}
            onUserMove={() => setFollow((f) => (f === "heading" ? "heading-free" : "off"))}
          />
          <RotateMap
            headingUp={follow === "heading" || follow === "heading-free"}
            heading={tracking.heading}
            onBearing={setMapBearing}
          />
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
                  key={p.id}
                  position={[p.lat, p.lng]}
                  title={p.name}
                  icon={i === 0 ? START_ICON : i === planPoints.length - 1 ? END_ICON : WAYPOINT_ICON}
                />
              ))
            : stops.map((p, i) => (
                <Marker
                  key={`stop-${i}`}
                  position={[p.lat, p.lng]}
                  title={p.name}
                  icon={i === 0 ? START_ICON : i === stops.length - 1 ? END_ICON : WAYPOINT_ICON}
                />
              ))}

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
                heading: tracking.heading,
                bearing: mapBearing,
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
                heading: r.isMe
                  ? tracking.heading
                  : ["fresh", "dim"].includes(r.stale)
                    ? r.heading
                    : null,
                bearing: mapBearing,
              })}
            />
          ))}
        </MapContainer>

        {/* Problems: banner on top of the map (in ride mode the HUD shows them) */}
        {problem && !rideMode && (
          <div className="ride-status has-error ride-map-alert">
            <span>{problem}</span>
          </div>
        )}

        {/* All good: a small pulsing dot instead of a status bar */}
        {joined && !problem && !rideMode && (
          <div
            className="ride-live"
            title={tracking.lastSentAt ? `Ubicación enviada ${timeAgo(ageSeconds(tracking.lastSentAt))}` : ""}
          >
            <span className="ride-live-dot" /> En vivo
          </div>
        )}

        {!rideMode && (
          <div className="ride-map-controls">
            <button onClick={enterRideMode} title="Pantalla completa (modo ride)" aria-label="Pantalla completa">
              <FullscreenIcon />
            </button>
            <button onClick={mapTheme.cycle} title={THEME_UI[mapTheme.mode].title} aria-label={THEME_UI[mapTheme.mode].title}>
              {THEME_UI[mapTheme.mode].icon}
            </button>
            {positioned.length > 0 && (
              <button onClick={showEveryone} title="Ver a todos" aria-label="Ver a todos">
                <GroupIcon />
              </button>
            )}
            {tracking.position && (
              <button
                onClick={cycleFollow}
                className={followMode === "off" ? "" : "is-on"}
                title={FOLLOW_UI[followMode].title}
                aria-label={FOLLOW_UI[followMode].title}
              >
                {FOLLOW_UI[followMode].icon}
              </button>
            )}
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
                    : !joined
                      ? "👀 Solo viendo: únete para compartir tu ubicación"
                      : `📡 ${riders.length} en el ride` +
                        (tracking.lastSentAt ? ` · enviada ${timeAgo(ageSeconds(tracking.lastSentAt))}` : "")}
              </span>
            </div>

            {/* My speed, big enough to read on the handlebar */}
            {tracking.position && (
              <div className="ride-speed" aria-label="Tu velocidad">
                <strong>{mySpeedKmh ?? "–"}</strong>
                <span>km/h</span>
              </div>
            )}

            {/* Bottom: big icon buttons (gloves) */}
            <div className="ride-mode-bar">
              <button onClick={showEveryone} disabled={positioned.length === 0} title="Ver a todos" aria-label="Ver a todos">
                <GroupIcon size={28} />
              </button>
              <button
                onClick={cycleFollow}
                disabled={!tracking.position}
                className={followMode === "off" ? "" : "is-on"}
                title={FOLLOW_UI[followMode].title}
                aria-label={FOLLOW_UI[followMode].title}
              >
                {React.cloneElement(FOLLOW_UI[followMode].icon, { size: 28 })}
              </button>
              {googleUrl && (
                <>
                  <a
                    className="is-secondary"
                    href={googleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Google Maps"
                    aria-label="Abrir en Google Maps"
                  >
                    <GoogleMapsIcon size={22} />
                  </a>
                  <a
                    className="is-secondary"
                    href={wazeLink(stops[stops.length - 1])}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Waze"
                    aria-label="Abrir en Waze"
                  >
                    <WazeIcon size={22} />
                  </a>
                </>
              )}
              <button onClick={mapTheme.cycle} title={THEME_UI[mapTheme.mode].title} aria-label={THEME_UI[mapTheme.mode].title}>
                {React.cloneElement(THEME_UI[mapTheme.mode].icon, { size: 28 })}
              </button>
              <button onClick={exitRideMode} title="Salir de pantalla completa" aria-label="Salir de pantalla completa">
                <ExitFullscreenIcon size={28} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Me in this ride: join (→ ride mode) or role + leave; organizer extras in ⋯ */}
      {ride && !planning && (
        <div className="ride-me">
          <select
            value={joined ? myRow.role : joinRole}
            onChange={(e) => (joined ? join(e.target.value) : setJoinRole(e.target.value))}
            disabled={busy}
            aria-label="Mi rol"
          >
            {Object.entries(ROLES).map(([key, r]) => (
              <option key={key} value={key}>
                {r.icon} {r.label}
              </option>
            ))}
          </select>
          {joined ? (
            <>
              <button className="btn" onClick={enterRideMode}>
                <FullscreenIcon size={16} /> Modo ride
              </button>
              <button className="btn btn-secondary" onClick={leave} disabled={busy}>
                Salir
              </button>
            </>
          ) : (
            <button className="btn ride-join" onClick={() => join()} disabled={busy}>
              Unirse
            </button>
          )}
          {canManage && (
            <div className="ride-menu">
              <button
                className="ride-icon-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                title="Más opciones"
                aria-label="Más opciones"
              >
                <MoreIcon size={18} />
              </button>
              {menuOpen && (
                <div className="ride-menu-list" role="menu">
                  <button role="menuitem" className="is-danger" onClick={endRide} disabled={busy}>
                    Terminar ride para todos
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
