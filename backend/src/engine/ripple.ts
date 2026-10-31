// "Domino" proqnozu: dolu avtobus irəlidəki dayanacaqlarda adam götürə bilmir, geridə qalanlar
// növbəti avtobusu gözləyir. Hər dayanacaq üçün 5/10/15 dəqiqə üfüqündə "minə bilməmə riski"
// hesablanır: üfüq ərzində yer olan (sıxlığı yüksək olmayan) avtobus gəlmirsə, risk artır.
export interface Arrival {
  busId: string;
  etaS: number;
  level: number | null; // 1..3
}

export interface RippleStop {
  stopId: string;
  seq: number;
  dir: 0 | 1;
  risk: [number, number, number]; // +5, +10, +15 dəqiqə; 0..1
  firstServiceableS: number | null;
}

export const HORIZONS_MIN = [5, 10, 15] as const;

export function stopRisk(arrivals: Arrival[], plannedHeadwayS: number): Pick<RippleStop, 'risk' | 'firstServiceableS'> {
  const sorted = [...arrivals].sort((a, b) => a.etaS - b.etaS);
  const serviceable = sorted.find((a) => (a.level ?? 1) < 3);
  const firstServiceableS = serviceable ? serviceable.etaS : null;
  const risk = HORIZONS_MIN.map((h) => {
    const H = h * 60;
    const wait = firstServiceableS == null ? H + plannedHeadwayS : Math.min(firstServiceableS, H + plannedHeadwayS);
    // planlaşdırılmış intervaldan artıq gözləmə — risk
    const excess = Math.max(0, wait - plannedHeadwayS);
    const fullPassing = sorted.filter((a) => a.etaS <= H && (a.level ?? 1) === 3).length;
    return Math.max(0, Math.min(1, excess / (2 * plannedHeadwayS) + 0.25 * fullPassing));
  }) as [number, number, number];
  return { risk, firstServiceableS };
}
