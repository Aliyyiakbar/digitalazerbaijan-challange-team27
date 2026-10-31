// Tıxac, yoxsa avtobus çatışmır?
// Dayanacaqlar arası hərəkət sürəti əsasən tıxacdan, dayanacaqda dayanma müddəti isə
// əsasən sərnişin axınından asılıdır. İkisini ayrıca ölçüb səbəbi təsnif edirik.
import type { Cause, Congestion } from './types.js';

export const FREE_FLOW_MS = 8.0; // ~29 km/s — Bakı şəhər daxili sərbəst hərəkət (sim baza)
export const BASE_DWELL_S = 22;

export interface CauseInput {
  movingSpeed: number | null; // m/s, dayanmalar xaric
  avgDwellS: number | null;
  crowdScore: number | null;
  /** Müqayisə bazası: şəbəkə üzrə median dayanma (adaptiv). Verilməsə BASE_DWELL_S. */
  baseDwellS?: number | null;
}

export interface CauseResult {
  cause: Cause;
  congestion: Congestion;
  speedRatio: number | null;
  dwellRatio: number | null;
  text: string;
}

export function congestionFromRatio(r: number | null): Congestion {
  if (r == null) return 'UNKNOWN_CONGESTION_LEVEL';
  if (r >= 0.8) return 'RUNNING_SMOOTHLY';
  if (r >= 0.6) return 'STOP_AND_GO';
  if (r >= 0.4) return 'CONGESTION';
  return 'SEVERE_CONGESTION';
}

export function classifyCause({ movingSpeed, avgDwellS, crowdScore, baseDwellS }: CauseInput): CauseResult {
  const speedRatio = movingSpeed == null ? null : movingSpeed / FREE_FLOW_MS;
  const dwellRatio = avgDwellS == null ? null : avgDwellS / (baseDwellS || BASE_DWELL_S);
  const congestion = congestionFromRatio(speedRatio);
  const slow = speedRatio != null && speedRatio < 0.6;
  const busyStops = (dwellRatio != null && dwellRatio > 1.5) || (crowdScore != null && crowdScore >= 2.4);
  let cause: Cause = 'normal';
  let text = 'Hərəkət normaldır';
  if (speedRatio == null && dwellRatio == null) {
    cause = 'unknown';
    text = 'Kifayət qədər GPS məlumatı yoxdur';
  } else if (slow && busyStops) {
    cause = 'mixed';
    text = 'Həm tıxac, həm yüksək tələbat';
  } else if (slow) {
    cause = 'traffic';
    text = 'Tıxac: avtobuslar yavaş gedir, dayanacaqlarda isə adi qədər dayanır';
  } else if (busyStops) {
    cause = 'demand';
    text = 'Tələbat: sürət normaldır, amma dayanacaqlarda çox sərnişin minir';
  }
  return { cause, congestion, speedRatio, dwellRatio, text };
}
