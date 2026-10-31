// Sıxlıq hesabı və etibar balı.
// Sıxlıq = son 10 dəqiqənin bildirişlərinin çəkili ortası (1..3). Köhnə bildirişin çəkisi
// hər 5 dəqiqədə yarıya enir. Çəki = cihaz etibarı × coğrafi çəki × köhnəlmə.
// Etibar balı (0..1) ayrıca hesablanır: həcm, cihaz müxtəlifliyi, razılaşma, coğrafiya
// və fiziki ziddiyyətlər (toplanmanın arxa avtobusu, qısa dayanma, proqnoz) əsasında.
import type { Badge, CrowdEstimate, CrowdReport, Level } from './types.js';

export const WINDOW_MS = 10 * 60_000;
export const HALF_LIFE_MS = 5 * 60_000;
export const HIGH_SCORE = 2.4;
export const MEDIUM_SCORE = 1.6;

export function scoreToLevel(score: number): Level {
  return score >= HIGH_SCORE ? 3 : score >= MEDIUM_SCORE ? 2 : 1;
}

export function reportWeight(r: CrowdReport, now: number): number {
  if (r.quarantined) return 0;
  const age = Math.max(0, now - r.ts);
  if (age > WINDOW_MS) return 0;
  return r.trust * r.geoWeight * Math.pow(0.5, age / HALF_LIFE_MS);
}

export interface PhysicsHints {
  /** Avtobus toplanmış qrupun arxasındadır (adətən boş gedir). */
  bunchedFollower?: boolean;
  /** Son dayanmalar normadan uzundur (çox sərnişin minir) — "yüksək"i dəstəkləyir. */
  longDwell?: boolean;
  /** Son dayanmalar qısadır və sürət normaldır — "yüksək"ə ziddir. */
  shortDwell?: boolean;
  /** Proqnoz modelinin bu vaxt üçün gözlədiyi bal (1..3). */
  expectedScore?: number | null;
  /** Bu xəttə bot hücumu şübhəsi var. */
  underAttack?: boolean;
}

export function badgeFor(conf: number, n: number, attack = false): Badge {
  if (n === 0) return 'none';
  if (attack) return 'suspicious';
  if (conf >= 0.65) return 'confirmed';
  if (conf >= 0.35) return 'check';
  return 'suspicious';
}

export function estimate(reports: CrowdReport[], now: number, hints: PhysicsHints = {}): CrowdEstimate {
  const live = reports.filter((r) => !r.quarantined && now - r.ts <= WINDOW_MS && r.ts <= now);
  const reasons: string[] = [];
  if (live.length === 0) {
    return { score: null, level: null, confidence: 0, badge: 'none', n: 0, devices: 0, effN: 0, reasons: ['Son 10 dəqiqədə bildiriş yoxdur'] };
  }
  let wSum = 0;
  let wl = 0;
  let geoSum = 0;
  for (const r of live) {
    const w = reportWeight(r, now);
    wSum += w;
    wl += w * r.level;
    geoSum += r.geoWeight;
  }
  const devices = new Set(live.map((r) => r.deviceId)).size;
  if (wSum <= 1e-6) {
    return { score: null, level: null, confidence: 0.05, badge: 'suspicious', n: live.length, devices, effN: 0, reasons: ['Bildirişlərin çəkisi sıfıra yaxındır'] };
  }
  const score = wl / wSum;
  // çəkili standart sapma — bildirişlər bir-birinə nə qədər ziddir
  let varSum = 0;
  for (const r of live) varSum += reportWeight(r, now) * (r.level - score) ** 2;
  const std = Math.sqrt(varSum / wSum);

  const volume = Math.min(1, wSum / 3);
  const diversity = Math.min(1, devices / 3);
  const agreement = Math.max(0, 1 - std / 1.0);
  const geo = geoSum / live.length;

  let conf = 0.3 * volume + 0.25 * diversity + 0.25 * agreement + 0.2 * geo;

  if (devices < 3) reasons.push(`Yalnız ${devices} fərqli cihaz`);
  else reasons.push(`${devices} fərqli cihazdan ${live.length} bildiriş`);
  if (std >= 0.8) reasons.push('Bildirişlər bir-birinə ziddir');
  if (geo < 0.5) reasons.push('Bildirişlərin çoxu avtobusdan/dayanacaqdan uzaqdan göndərilib');

  const level = scoreToLevel(score);
  if (level === 3) {
    if (hints.bunchedFollower) {
      conf *= 0.5;
      reasons.push('Avtobus toplanmış qrupun arxasındadır — bu vəziyyətdə adətən boş gedir');
    }
    if (hints.shortDwell) {
      conf *= 0.75;
      reasons.push('Dayanacaqlarda dayanma qısadır, sürət normaldır — doluluqla uyğun gəlmir');
    }
    if (hints.longDwell) {
      conf = Math.min(1, conf * 1.15 + 0.05);
      reasons.push('Dayanacaqlarda dayanma uzanıb — çox sərnişin minir (GPS təsdiqləyir)');
    }
    if (hints.expectedScore != null && hints.expectedScore < MEDIUM_SCORE) {
      conf *= 0.8;
      reasons.push('Bu saat üçün proqnoz aşağı sıxlıq gözləyirdi');
    } else if (hints.expectedScore != null && hints.expectedScore >= HIGH_SCORE - 0.3) {
      conf = Math.min(1, conf + 0.05);
      reasons.push('Proqnoz da yüksək sıxlıq gözləyirdi');
    }
  }
  if (hints.underAttack) {
    conf = Math.min(conf, 0.2);
    reasons.push('Bu xətt üzrə bot hücumu şübhəsi var');
  }
  conf = Math.max(0, Math.min(1, conf));
  return { score, level, confidence: conf, badge: badgeFor(conf, live.length, hints.underAttack), n: live.length, devices, effN: wSum, reasons };
}
