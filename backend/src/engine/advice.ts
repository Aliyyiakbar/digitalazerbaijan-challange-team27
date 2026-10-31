// "Bunu burax, növbəti avtobus boşdur" tövsiyəsi.
export interface AdviceArrival {
  busId: string;
  routeId: string;
  label: string;
  etaS: number;
  level: number | null;
  badge: string;
  bunchedFollower: boolean;
}

export interface SkipAdvice {
  skipBusId: string;
  takeBusId: string;
  extraWaitS: number;
  text: string;
  certain: boolean;
}

export const MAX_EXTRA_WAIT_S = 6 * 60;

export function skipAdvice(arrivals: AdviceArrival[]): SkipAdvice | null {
  const byRoute = new Map<string, AdviceArrival[]>();
  for (const a of arrivals) {
    if (!byRoute.has(a.routeId)) byRoute.set(a.routeId, []);
    byRoute.get(a.routeId)!.push(a);
  }
  let best: SkipAdvice | null = null;
  for (const list of byRoute.values()) {
    list.sort((a, b) => a.etaS - b.etaS);
    const [first, ...rest] = list;
    if (!first || first.level !== 3) continue;
    const next = rest.find((a) => a.etaS - first.etaS <= MAX_EXTRA_WAIT_S && ((a.level != null && a.level <= 2) || a.bunchedFollower));
    if (!next) continue;
    const extra = Math.max(0, next.etaS - first.etaS);
    const certain = first.badge === 'confirmed' && (next.level != null || next.bunchedFollower);
    const why = next.level === 1 ? 'yer var' : next.level === 2 ? 'orta sıxlıq' : 'adətən boş gəlir (qrupun arxasındadır)';
    const text = `${first.label} doludur. ${Math.max(1, Math.round(extra / 60))} dəq gözləsən, ${next.label} gələcək — ${why}.`;
    const cand = { skipBusId: first.busId, takeBusId: next.busId, extraWaitS: extra, text, certain };
    if (!best || cand.extraWaitS < best.extraWaitS) best = cand;
  }
  return best;
}
