import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { bearingDegrees, distanceMeters, isNetworkError } from "../lib/routing";

// Send filter: push a position only when it's worth it (battery + data)
const MIN_INTERVAL_MS = 10_000; // never more often than every 10 s
const MIN_DISTANCE_M = 50; // ...and only after moving 50 m
const HEARTBEAT_MS = 60_000; // but always once a minute, so a stopped rider stays "fresh"
const RETRY_MS = 5_000; // after a failed send (no signal): retry on the next fix after 5 s

// Heading (direction of travel): the GPS course when moving fast enough, else
// computed from positions at least 15 m apart. Kept while stopped.
const HEADING_MIN_SPEED = 1.5; // m/s (~5 km/h)
const HEADING_MIN_MOVE_M = 15;

const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 };

/**
 * While `active`, follows the device GPS and pushes the position of the
 * current member to `rideId` via update_ride_location. Keeps the screen on
 * (Wake Lock) because browsers stop GPS when the app is in the background.
 *
 * - No signal: the failed position is retried on the next fix and as soon as
 *   the browser reports it's back online (no 50 m wait).
 * - App hidden / closed: marks the rider as "paused" (set_ride_paused) so the
 *   others see "pausado" instead of "sin señal". The next send clears it.
 *
 * While not `active`, only watches the GPS locally (position for the map).
 *
 * Returns { position, heading, error, offline, wakeLock, lastSentAt }.
 */
export default function useRideTracking(rideId, active) {
  const [position, setPosition] = useState(null);
  const [heading, setHeading] = useState(null); // degrees, 0 = north
  const headingRef = useRef(null);
  const headingAnchor = useRef(null); // last position used to compute the heading
  const prevFix = useRef(null); // { lat, lng, t } for speed when the GPS doesn't give it
  const speedRef = useRef(null); // latest speed (GPS or computed), sent with the position
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const [wakeLock, setWakeLock] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(null);
  const lastSent = useRef(null); // { lat, lng, at } of the last successful send
  const lastAttempt = useRef(0);
  const pending = useRef(false); // last send failed, retry ASAP
  const latest = useRef(null); // latest GPS fix (GeolocationPosition)
  const sending = useRef(false);

  // Local state for every fix: position for the map + heading
  const updateLocal = useCallback((pos) => {
    const { latitude: lat, longitude: lng, accuracy, heading: gpsHeading } = pos.coords;
    const here = { lat, lng };

    // Speed (m/s): from the GPS, or computed from the previous fix (some phones/browsers give null)
    let speed = pos.coords.speed;
    const prev = prevFix.current;
    if (!Number.isFinite(speed) && prev) {
      const dt = (pos.timestamp - prev.t) / 1000;
      speed = dt >= 1 ? distanceMeters(prev, here) / dt : null;
    }
    prevFix.current = { ...here, t: pos.timestamp };
    speedRef.current = Number.isFinite(speed) ? speed : null;
    setPosition({ ...here, accuracy, speed: Number.isFinite(speed) ? speed : null });

    let next = null;
    if (Number.isFinite(gpsHeading) && speed >= HEADING_MIN_SPEED) {
      next = gpsHeading;
      headingAnchor.current = here;
    } else if (!headingAnchor.current) {
      headingAnchor.current = here;
    } else if (distanceMeters(headingAnchor.current, here) >= HEADING_MIN_MOVE_M) {
      next = bearingDegrees(headingAnchor.current, here);
      headingAnchor.current = here;
    }
    if (next != null) {
      headingRef.current = Math.round(next);
      setHeading(headingRef.current);
    }
    return here;
  }, []);

  // GPS watch + send filter + retries + pause/resume
  useEffect(() => {
    if (!active || !rideId) return;
    if (!("geolocation" in navigator)) {
      setError("Este dispositivo no tiene GPS disponible");
      return;
    }
    lastSent.current = null;
    pending.current = false;

    const send = async (pos) => {
      if (sending.current) return;
      sending.current = true;
      lastAttempt.current = Date.now();
      const { latitude, longitude, speed, accuracy } = pos.coords;
      const { error: rpcError } = await supabase.rpc("update_ride_location", {
        p_ride_id: rideId,
        p_lat: latitude,
        p_lng: longitude,
        p_speed: Number.isFinite(speed) ? speed : speedRef.current,
        p_heading: headingRef.current,
        p_accuracy: accuracy,
      });
      sending.current = false;
      if (rpcError) {
        pending.current = true;
        if (isNetworkError(rpcError)) setOffline(true);
        else setError(rpcError.message);
        return;
      }
      pending.current = false;
      lastSent.current = { lat: latitude, lng: longitude, at: Date.now() };
      setLastSentAt(new Date());
      setOffline(false);
      setError(null);
    };

    const sendFresh = () =>
      navigator.geolocation.getCurrentPosition(send, () => {}, GPS_OPTIONS);
    // retry with the latest fix if it's recent, otherwise ask the GPS again
    const sendLatestOrFresh = () => {
      const fix = latest.current;
      if (fix && Date.now() - fix.timestamp < 15_000) send(fix);
      else sendFresh();
    };

    const setPaused = (paused) => {
      // fire-and-forget: the page may be going away
      supabase.rpc("set_ride_paused", { p_ride_id: rideId, p_paused: paused }).then(
        () => {},
        () => {}
      );
    };

    const onPosition = (pos) => {
      latest.current = pos;
      const here = updateLocal(pos);

      const prev = lastSent.current;
      if (!prev) {
        // first fix (or still failing): send, but don't hammer while offline
        if (!pending.current || Date.now() - lastAttempt.current >= RETRY_MS) send(pos);
        return;
      }
      if (pending.current) {
        if (Date.now() - lastAttempt.current >= RETRY_MS) send(pos);
        return;
      }
      const elapsed = Date.now() - prev.at;
      if (elapsed < MIN_INTERVAL_MS) return;
      if (elapsed >= HEARTBEAT_MS || distanceMeters(prev, here) >= MIN_DISTANCE_M) {
        send(pos);
      }
    };

    const onError = (err) => {
      setError(
        err.code === err.PERMISSION_DENIED
          ? "Permiso de ubicación denegado. Actívalo en el navegador."
          : "No se pudo obtener tu ubicación"
      );
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      ...GPS_OPTIONS,
      maximumAge: 5_000,
    });

    // watchPosition only fires on movement on some phones: heartbeat timer
    // (also retries a failed send when the rider is stopped)
    const heartbeat = setInterval(() => {
      const prev = lastSent.current;
      const due = prev && Date.now() - prev.at >= HEARTBEAT_MS;
      const retry = pending.current && Date.now() - lastAttempt.current >= RETRY_MS;
      if (due || retry) sendLatestOrFresh();
    }, RETRY_MS * 2);

    const onOnline = () => {
      if (pending.current) sendLatestOrFresh();
    };
    const onOffline = () => setOffline(true);

    // Background: GPS stops, so tell the others we're paused. Back: send right away.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setPaused(true);
      else sendFresh();
    };
    const onPageHide = () => setPaused(true);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // left the page inside the app (or the ride): GPS stops here too.
      // Harmless when the row was just deleted (leave / end).
      setPaused(true);
      setOffline(false);
    };
  }, [rideId, active, updateLocal]);

  // Not sharing (not joined / no ride): still follow the GPS locally so the map
  // can show "you are here". Nothing is sent.
  useEffect(() => {
    if (active || !("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      updateLocal,
      () => {}, // permission denied: just no marker until they join
      { ...GPS_OPTIONS, enableHighAccuracy: false, maximumAge: 30_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active, updateLocal]);

  // Keep the screen on while riding (re-acquired when the app comes back)
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) return lock.release();
        setWakeLock(true);
        lock.addEventListener("release", () => setWakeLock(false));
      } catch {
        setWakeLock(false);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release();
      setWakeLock(false);
    };
  }, [active]);

  return { position, heading, error, offline, wakeLock, lastSentAt };
}
