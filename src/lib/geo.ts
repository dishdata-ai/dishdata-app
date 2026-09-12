// Browser geolocation for the My Day clock-in geofence. See [[timeclock]].
// Everything here is best-effort: it only runs while this tab is open and
// the visitor has granted location permission. There is no way for a web
// page to keep checking location in the background after the tab closes or
// the phone sleeps — that gap is why a time-based safety net exists too
// (org.max_shift_hours, enforced by the force-clockout cron).

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
}

/** Meters between two lat/lng points (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export class GeoError extends Error {
  constructor(public reason: "unsupported" | "denied" | "unavailable" | "timeout", message: string) {
    super(message);
  }
}

/** One-shot position read, wrapped in our own error type so callers get a message they can show. */
export function getCurrentPosition(timeoutMs = 10000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new GeoError("unsupported", "This device/browser can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GeoError("denied", "Location access was denied. Enable it in your browser settings to clock in here."));
        } else if (err.code === err.TIMEOUT) {
          reject(new GeoError("timeout", "Couldn't get a location fix in time — try again."));
        } else {
          reject(new GeoError("unavailable", "Couldn't determine your location."));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export interface Geofence {
  lat: number;
  lng: number;
  radiusM: number;
}

/** Reads org.clockin_* into a Geofence, or null when the org hasn't set one up. */
export function geofenceOf(org: {
  clockin_lat: number | null;
  clockin_lng: number | null;
  clockin_radius_m: number | null;
}): Geofence | null {
  if (org.clockin_lat == null || org.clockin_lng == null || org.clockin_radius_m == null) return null;
  return { lat: org.clockin_lat, lng: org.clockin_lng, radiusM: org.clockin_radius_m };
}
