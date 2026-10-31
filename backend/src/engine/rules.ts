// Tapşırığın əsas qaydası:
//   "Əgər bir xətt üzrə 10 dəqiqə ərzində sıxlıq səviyyəsi yüksək kimi qeydə alınarsa, operator
//    panelində avtomatik olaraq 'əlavə avtobus ehtiyatı ayrılmalıdır' tövsiyəsi yaradılmalıdır."
// Şərh: xətt FASİLƏSİZ 10 dəqiqə "yüksək" vəziyyətdə qalıbsa → tövsiyə avtomatik yaranır.
// "Yüksək" vəziyyət: çəkili bal ≥ 2.4, pəncərədə ≥ 5 bildiriş və ≥ 3 fərqli cihaz
// (tək bir istifadəçi xəbərdarlıq yarada bilməsin). 60 saniyəlik qısa enişlər fasilə sayılmır.
import type { CrowdEstimate } from './types.js';
import { HIGH_SCORE } from './crowd.js';

export const SUSTAIN_MS = 10 * 60_000;
export const GRACE_MS = 60_000;
export const COOLDOWN_MS = 10 * 60_000;
export const MIN_REPORTS = 5;
export const MIN_DEVICES = 3;

export function isHigh(e: CrowdEstimate): boolean {
  return e.score != null && e.score >= HIGH_SCORE && e.n >= MIN_REPORTS && e.devices >= MIN_DEVICES;
}

interface RouteRuleState {
  highSince: number | null;
  lowSince: number | null; // cari enişin başlanğıcı
  lastFired: number | null;
}

export interface RuleResult {
  high: boolean;
  highForMs: number;
  fire: boolean;
}

export class SustainedHighRule {
  private st = new Map<string, RouteRuleState>();

  constructor(
    private sustainMs = SUSTAIN_MS,
    private graceMs = GRACE_MS,
    private cooldownMs = COOLDOWN_MS,
  ) {}

  evaluate(routeId: string, e: CrowdEstimate, now: number): RuleResult {
    const s = this.st.get(routeId) ?? { highSince: null, lowSince: null, lastFired: null };
    this.st.set(routeId, s);
    const high = isHigh(e);
    if (high) {
      // eniş GRACE-dən uzun sürübsə — sayğac yenidən başlayır
      if (s.highSince == null || (s.lowSince != null && now - s.lowSince > this.graceMs)) s.highSince = now;
      s.lowSince = null;
    } else {
      s.lowSince ??= now;
      if (now - s.lowSince > this.graceMs) s.highSince = null;
    }
    const highForMs = s.highSince != null ? now - s.highSince : 0;
    const fire = s.highSince != null && highForMs >= this.sustainMs && (s.lastFired == null || now - s.lastFired >= this.cooldownMs);
    if (fire) s.lastFired = now;
    return { high, highForMs, fire };
  }

  /** Operator ehtiyat avtobus göndərəndə yeni sayğac başlayır. */
  reset(routeId: string, now: number): void {
    const s = this.st.get(routeId);
    if (s) {
      s.highSince = null;
      s.lastFired = now;
    }
  }

  snapshot(routeId: string): RouteRuleState | undefined {
    return this.st.get(routeId);
  }
}
