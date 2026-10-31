// Coğrafi köməkçi funksiyalar: məsafə, polilayn boyunca proyeksiya və interpolyasiya.
export type LatLon = [number, number];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Polilayn + hər nöqtəyə qədər yığılmış məsafə (metr). */
export interface Path {
  pts: LatLon[];
  cum: number[];
  length: number;
}

export function makePath(pts: LatLon[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Yol boyunca `d` metr məsafədəki nöqtə (d dövri ola bilər). */
export function pointAt(path: Path, d: number): LatLon {
  const L = path.length;
  let x = ((d % L) + L) % L;
  let lo = 0;
  let hi = path.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = path.cum[hi] - path.cum[lo] || 1;
  const t = (x - path.cum[lo]) / seg;
  const a = path.pts[lo];
  const b = path.pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** İstiqamət bucağı (dərəcə, şimaldan saat əqrəbi ilə). */
export function bearingAt(path: Path, d: number): number {
  const a = pointAt(path, d);
  const b = pointAt(path, d + 15);
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Nöqtəni polilayna proyeksiya edir. `window` verilərsə, yalnız [from, to] məsafə aralığındakı
 * seqmentlərə baxılır — gediş-qayıdış xətlərində (eyni küçə iki istiqamətdə) istiqaməti qarışdırmamaq üçün.
 */
export function project(path: Path, p: LatLon, window?: { from: number; to: number }): { d: number; offset: number } {
  // lokal ekvirektangulyar proyeksiya (Bakı miqyasında kifayət qədər dəqiqdir)
  const k = Math.cos(rad(p[0]));
  const toXY = (q: LatLon) => [rad(q[1]) * k * R, rad(q[0]) * R];
  const [px, py] = toXY(p);
  let best = { d: 0, offset: Infinity };
  const L = path.length;
  const inWindow = (d: number) => {
    if (!window) return true;
    const span = window.to - window.from;
    if (span >= L) return true;
    const rel = (((d - window.from) % L) + L) % L;
    return rel <= span;
  };
  for (let i = 1; i < path.pts.length; i++) {
    const segStart = path.cum[i - 1];
    const segEnd = path.cum[i];
    if (window && !inWindow(segStart) && !inWindow(segEnd)) continue;
    const [ax, ay] = toXY(path.pts[i - 1]);
    const [bx, by] = toXY(path.pts[i]);
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    const off = Math.hypot(px - qx, py - qy);
    const d = segStart + (segEnd - segStart) * t;
    if (off < best.offset && inWindow(d)) best = { d, offset: off };
  }
  return best;
}

/** Dövri məsafə: a-dan irəli b-yə qədər (0..L). */
export function aheadDistance(from: number, to: number, L: number): number {
  return (((to - from) % L) + L) % L;
}
