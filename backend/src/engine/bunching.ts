// Avtobusların bir-birinin ardınca toplanması (bus bunching) və intervalda boşluqlar.
// Interval əsaslı "saxlama" (holding) üsulu: toplanmış cütün arxadakı avtobusu nəzarət
// dayanacağında (ön_interval − arxa_interval)/2 qədər saxlanılır ki, intervallar bərabərləşsin.
import { aheadDistance } from '../lib/geo.js';

export interface BusOnLoop {
  id: string;
  d: number;
  label: string;
}

export interface HeadwayInfo {
  busId: string;
  label: string;
  aheadBusId: string | null;
  gapAheadS: number; // öndəki avtobusa qədər vaxt
  gapBehindS: number; // arxadakı avtobusa qədər vaxt
  ratio: number; // gapAhead / ideal
  bunched: boolean; // öndəkinə çox yaxındır (bu avtobus "arxadakıdır")
  holdS: number; // tövsiyə olunan saxlama
}

export interface BunchingResult {
  idealS: number;
  headways: HeadwayInfo[];
  cv: number; // intervalların variasiya əmsalı (0 = ideal bərabər)
  pairs: Array<{ leader: string; follower: string; gapS: number; holdS: number }>;
  bigGaps: Array<{ before: string; gapS: number }>;
}

export const BUNCH_RATIO = 0.3;
export const GAP_RATIO = 1.8;

export function analyzeHeadways(buses: BusOnLoop[], loopLength: number, avgSpeed: number): BunchingResult {
  const n = buses.length;
  const v = Math.max(2, avgSpeed);
  const idealS = loopLength / v / Math.max(1, n);
  if (n < 2) return { idealS, headways: buses.map((b) => ({ busId: b.id, label: b.label, aheadBusId: null, gapAheadS: idealS, gapBehindS: idealS, ratio: 1, bunched: false, holdS: 0 })), cv: 0, pairs: [], bigGaps: [] };

  const sorted = [...buses].sort((a, b) => a.d - b.d);
  const gapAhead = new Map<string, { id: string; s: number }>();
  for (let i = 0; i < n; i++) {
    const cur = sorted[i];
    const nxt = sorted[(i + 1) % n];
    gapAhead.set(cur.id, { id: nxt.id, s: aheadDistance(cur.d, nxt.d, loopLength) / v });
  }
  const gapBehind = new Map<string, number>();
  for (const [id, g] of gapAhead) gapBehind.set(g.id, g.s);

  const headways: HeadwayInfo[] = sorted.map((b) => {
    const ga = gapAhead.get(b.id)!;
    const gb = gapBehind.get(b.id) ?? idealS;
    const ratio = ga.s / idealS;
    const bunched = ratio < BUNCH_RATIO;
    const holdS = bunched ? Math.max(0, Math.min(600, (gb - ga.s) / 2)) : 0;
    return { busId: b.id, label: b.label, aheadBusId: ga.id, gapAheadS: ga.s, gapBehindS: gb, ratio, bunched, holdS };
  });
  const gaps = headways.map((h) => h.gapAheadS);
  const mean = gaps.reduce((a, b) => a + b, 0) / n;
  const cv = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / n) / (mean || 1);
  const pairs = headways.filter((h) => h.bunched).map((h) => ({ leader: h.aheadBusId!, follower: h.busId, gapS: h.gapAheadS, holdS: h.holdS }));
  const bigGaps = headways.filter((h) => h.ratio > GAP_RATIO).map((h) => ({ before: h.aheadBusId!, gapS: h.gapAheadS }));
  return { idealS, headways, cv, pairs, bigGaps };
}
