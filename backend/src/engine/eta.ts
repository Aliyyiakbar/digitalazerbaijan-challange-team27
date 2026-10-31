// Gözlənilən gəliş vaxtı (ETA).
// 1) avtobusun dövrə üzrə mövqeyi məlumdur; 2) dayanacağa qalan məsafə hesablanır;
// 3) avtobusun hamarlanmış sürəti ilə xəttin son orta hərəkət sürəti qarışdırılır;
// 4) yolda qalan hər aralıq dayanacaq üçün orta dayanma müddəti əlavə olunur.
import { aheadDistance } from '../lib/geo.js';
import type { LoopStop } from './network.js';

export const DEFAULT_DWELL_S = 22;

export function effectiveSpeed(busSpeed: number, routeMovingSpeed: number | null): number {
  const route = routeMovingSpeed ?? 7;
  // avtobus hazırda dayanırsa onun sürəti 0-dır — xəttin ortasına güvənirik
  const v = busSpeed < 1.5 ? route : 0.5 * busSpeed + 0.5 * route;
  return Math.max(1.5, v);
}

export function etaSeconds(
  busD: number,
  stopD: number,
  loopLength: number,
  loopStops: LoopStop[],
  speed: number,
  dwellS = DEFAULT_DWELL_S,
): { seconds: number; distance: number; stopsBetween: number } {
  const distance = aheadDistance(busD, stopD, loopLength);
  let stopsBetween = 0;
  for (const s of loopStops) {
    const a = aheadDistance(busD, s.d, loopLength);
    if (a > 25 && a < distance - 1) stopsBetween++;
  }
  return { seconds: distance / speed + stopsBetween * dwellS, distance, stopsBetween };
}
