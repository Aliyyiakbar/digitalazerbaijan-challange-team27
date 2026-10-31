// Cihaz etibarı (reputasiya) və coğrafi yoxlama.
// "Truth discovery" ideyası: mənbənin etibarı onun bildirişlərinin konsensusla nə qədər
// üst-üstə düşməsindən asılıdır; konsensus isə etibarla çəkilmiş bildirişlərdən hesablanır.
export const TRUST_START = 0.5;
export const TRUST_MIN = 0.1;
export const TRUST_MAX = 1.0;
export const NEW_DEVICE_MS = 5 * 60_000;

export function updateTrust(trust: number, level: number, consensus: number | null, consensusConf: number): number {
  if (consensus == null || consensusConf < 0.4) return trust; // müqayisə üçün etibarlı konsensus yoxdur
  const diff = Math.abs(level - consensus);
  let t = trust;
  if (diff < 0.75) t += 0.05;
  else if (diff >= 1.5) t -= 0.1;
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, t));
}

/** Yeni cihazların ilk dəqiqələrdə çəkisi aşağıdır. */
export function effectiveTrust(trust: number, deviceAgeMs: number): number {
  return deviceAgeMs < NEW_DEVICE_MS ? Math.min(trust, 0.3) : trust;
}

/**
 * Coğrafi çəki: bildiriş göndərən avtobusa/dayanacağa nə qədər yaxındır.
 * Koordinat yoxdursa bildiriş rədd edilmir, sadəcə zəif sayılır.
 */
export function geoWeight(distanceM: number | null, accuracyM: number | null): number {
  if (distanceM == null || (accuracyM != null && accuracyM > 500)) return 0.4;
  if (distanceM <= 150) return 1.0;
  if (distanceM <= 400) return 0.6;
  if (distanceM <= 1000) return 0.25;
  return 0.1;
}
