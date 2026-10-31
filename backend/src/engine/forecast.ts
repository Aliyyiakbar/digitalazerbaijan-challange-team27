// Sıxlıq proqnozu (15 və 30 dəqiqə irəli).
// Model iki hissədən ibarətdir:
//   1) Baza: xətt × 15 dəqiqəlik zaman aralığı × gün növü üzrə tarixi orta bal (1..3).
//   2) Real vaxt düzəlişi: son müşahidələrin bazadan kənarlaşmasının eksponensial hamarlanmış
//      ortası (EWMA); proqnoz üfüqü uzandıqca bu düzəlişin təsiri sönür.
// Ədəbiyyatda ən güclü əlamətlər məhz günün saatı, gün növü və tarixi doluluqdur (GBDT modelləri).
// Real AYNA/BakıKart məlumatı ilə növbəti addım LightGBM-dir (docs/TEXNIKI_IZAH.md).

export const SLOT_MIN = 15;
export const SLOTS = (24 * 60) / SLOT_MIN;
const RESIDUAL_TAU_MIN = 45;
const EWMA_ALPHA = 0.25;

export type DayType = 'weekday' | 'weekend';

export function slotOf(ts: number, tzOffsetMin = 240): number {
  const m = Math.floor((ts / 60_000 + tzOffsetMin) % (24 * 60));
  return Math.floor(((m + 24 * 60) % (24 * 60)) / SLOT_MIN);
}

export function dayTypeOf(ts: number, tzOffsetMin = 240): DayType {
  const d = new Date(ts + tzOffsetMin * 60_000).getUTCDay();
  return d === 0 || d === 6 ? 'weekend' : 'weekday';
}

export interface Observation {
  ts: number;
  routeId: string;
  score: number;
}

export class ForecastModel {
  // açar: route|daytype → SLOTS uzunluqlu massiv [cəm, say]
  private table = new Map<string, Array<[number, number]>>();
  private residual = new Map<string, { value: number; ts: number }>();

  train(obs: Observation[]): void {
    this.table.clear();
    for (const o of obs) {
      const key = `${o.routeId}|${dayTypeOf(o.ts)}`;
      if (!this.table.has(key)) this.table.set(key, Array.from({ length: SLOTS }, () => [0, 0] as [number, number]));
      const cell = this.table.get(key)![slotOf(o.ts)];
      cell[0] += o.score;
      cell[1] += 1;
    }
  }

  get trained(): boolean {
    return this.table.size > 0;
  }

  baseline(routeId: string, ts: number): number | null {
    const arr = this.table.get(`${routeId}|${dayTypeOf(ts)}`) ?? this.table.get(`${routeId}|weekday`);
    if (!arr) return null;
    const s = slotOf(ts);
    // qonşu aralıqlarla yumşaq hamarlama
    let sum = 0;
    let w = 0;
    for (const [k, wk] of [[-1, 0.25], [0, 0.5], [1, 0.25]] as const) {
      const c = arr[(s + k + SLOTS) % SLOTS];
      if (c[1] > 0) {
        sum += (c[0] / c[1]) * wk;
        w += wk;
      }
    }
    return w > 0 ? sum / w : null;
  }

  observe(routeId: string, ts: number, score: number): void {
    const b = this.baseline(routeId, ts);
    if (b == null) return;
    const prev = this.residual.get(routeId);
    const r = score - b;
    const value = prev ? prev.value + EWMA_ALPHA * (r - prev.value) : r;
    this.residual.set(routeId, { value, ts });
  }

  predict(routeId: string, now: number, horizonMin: number): number | null {
    const b = this.baseline(routeId, now + horizonMin * 60_000);
    if (b == null) return null;
    const res = this.residual.get(routeId);
    let adj = 0;
    if (res && now - res.ts < 30 * 60_000) adj = res.value * Math.exp(-horizonMin / RESIDUAL_TAU_MIN);
    return Math.max(1, Math.min(3, b + adj));
  }

  /** Sadə yoxlama: verilmiş müşahidələrdə baza modelinin orta mütləq xətası. */
  mae(obs: Observation[]): number | null {
    let s = 0;
    let n = 0;
    for (const o of obs) {
      const b = this.baseline(o.routeId, o.ts);
      if (b == null) continue;
      s += Math.abs(b - o.score);
      n++;
    }
    return n ? s / n : null;
  }
}
