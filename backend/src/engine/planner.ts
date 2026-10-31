// Sıxlığı nəzərə alan marşrut planlayıcısı (ən çox 1 köçürmə).
// Şəbəkə kiçikdir və cədvəl intervala əsaslanır, ona görə RAPTOR-un 2 raundluq (0 və 1 köçürmə)
// sadələşdirilmiş versiyası kifayətdir. Real ETA-lar istifadə olunur.
// "Hiss olunan vaxt": yol vaxtı sıxlıq əmsalı ilə vurulur — Wardman & Whelan (2011) meta-analizi:
// oturaraq ~1.19, ayaq üstə ~2.32 dəfə uzun hiss olunur.
import type { LoopStop, Network } from './network.js';
import { aheadDistance } from '../lib/geo.js';

export const CROWD_MULT: Record<number, number> = { 1: 1.0, 2: 1.19, 3: 2.32 };
export const TRANSFER_PENALTY_S = 180;
export const TRANSFER_WALK_S = 120;

export interface LiveArrivalFn {
  /** Verilmiş xətt üçün dayanacağın dövrə nöqtəsinə `afterS` saniyədən sonra gələn ilk avtobus. */
  (routeId: string, loopStop: LoopStop, afterS: number): { busId: string; label: string; etaS: number; level: number | null } | null;
}

export interface Leg {
  routeId: string;
  busId: string;
  busLabel: string;
  fromStopId: string;
  toStopId: string;
  waitS: number;
  rideS: number;
  level: number | null;
  towards: string;
}

export interface Journey {
  legs: Leg[];
  totalS: number; // real vaxt
  perceivedS: number; // hiss olunan vaxt
  transfers: number;
  comfort: 'yer var' | 'orta' | 'ayaq üstə';
}

function rideSeconds(from: LoopStop, to: LoopStop, loopStops: LoopStop[], L: number, speed: number): number {
  const dist = aheadDistance(from.d, to.d, L);
  const between = loopStops.filter((s) => {
    const a = aheadDistance(from.d, s.d, L);
    return a > 1 && a < dist - 1;
  }).length;
  return dist / speed + between * 22;
}

export function plan(net: Network, fromStop: string, toStop: string, arrival: LiveArrivalFn, routeSpeed: (r: string) => number, limit = 3): Journey[] {
  const out: Journey[] = [];
  const finish = (legs: Leg[]): Journey => {
    let total = 0;
    let perceived = 0;
    let worst = 1;
    legs.forEach((l, i) => {
      total += l.waitS + l.rideS;
      perceived += l.waitS * 1.5 + l.rideS * CROWD_MULT[l.level ?? 1];
      if (i > 0) perceived += TRANSFER_PENALTY_S;
      worst = Math.max(worst, l.level ?? 1);
    });
    return { legs, totalS: total, perceivedS: perceived, transfers: legs.length - 1, comfort: worst === 1 ? 'yer var' : worst === 2 ? 'orta' : 'ayaq üstə' };
  };

  // mümkün gediş: xəttin dövrəsində A-dan B-yə (irəli, bir dövrədən az)
  const segments = (routeId: string, a: string, b: string) => {
    const r = net.routes.get(routeId)!;
    const res: Array<{ from: LoopStop; to: LoopStop }> = [];
    for (const s1 of r.loopStops.filter((s) => s.stopId === a))
      for (const s2 of r.loopStops.filter((s) => s.stopId === b)) {
        if (s1 === s2) continue;
        res.push({ from: s1, to: s2 });
      }
    // ən qısa irəli gedişi seç
    res.sort((x, y) => aheadDistance(x.from.d, x.to.d, r.path.length) - aheadDistance(y.from.d, y.to.d, r.path.length));
    return res.slice(0, 1);
  };

  const mkLeg = (routeId: string, seg: { from: LoopStop; to: LoopStop }, afterS: number): Leg | null => {
    const r = net.routes.get(routeId)!;
    const arr = arrival(routeId, seg.from, afterS);
    if (!arr) return null;
    return {
      routeId,
      busId: arr.busId,
      busLabel: arr.label,
      fromStopId: seg.from.stopId,
      toStopId: seg.to.stopId,
      waitS: Math.max(0, arr.etaS - afterS),
      rideS: rideSeconds(seg.from, seg.to, r.loopStops, r.path.length, routeSpeed(routeId)),
      level: arr.level,
      towards: seg.from.towards,
    };
  };

  const fromRoutes = net.routesByStop.get(fromStop) ?? [];
  // 0 köçürmə
  for (const rid of fromRoutes) {
    for (const seg of segments(rid, fromStop, toStop)) {
      const leg = mkLeg(rid, seg, 0);
      if (leg) out.push(finish([leg]));
    }
  }
  // 1 köçürmə
  for (const r1 of fromRoutes) {
    const route1 = net.routes.get(r1)!;
    for (const transfer of new Set(route1.stopIds)) {
      if (transfer === fromStop || transfer === toStop) continue;
      for (const r2 of net.routesByStop.get(transfer) ?? []) {
        if (r2 === r1) continue;
        const s1 = segments(r1, fromStop, transfer)[0];
        const s2 = segments(r2, transfer, toStop)[0];
        if (!s1 || !s2) continue;
        const l1 = mkLeg(r1, s1, 0);
        if (!l1) continue;
        const l2 = mkLeg(r2, s2, l1.waitS + l1.rideS + TRANSFER_WALK_S);
        if (!l2) continue;
        l2.waitS += TRANSFER_WALK_S;
        out.push(finish([l1, l2]));
      }
    }
  }
  // eyni xətt kombinasiyalarının təkrarını at, hiss olunan vaxta görə sırala
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.perceivedS - b.perceivedS)
    .filter((j) => {
      const k = j.legs.map((l) => l.routeId).join('>');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}
