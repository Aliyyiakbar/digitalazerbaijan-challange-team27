export interface Pos {
  lat: number;
  lon: number;
  accuracy: number;
}

/** Brauzerin yer məlumatı. Yalnız HTTPS və ya localhost-da işləyir; icazə verilməsə null. */
export function getPosition(timeoutMs = 6000): Promise<Pos | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
