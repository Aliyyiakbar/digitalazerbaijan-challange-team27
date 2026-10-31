// Proqnoz qrafiki: bir seriya, y-oxu 1..3 (aşağı/orta/yüksək), "indi"dən sonra xətt qırıq-qırıqdır
// (proqnoz fakt deyil), yüksək sərhəd 2.4 istinad xətti kimi işarələnir.
import { fmtClock } from '../lib/format';

export interface FPoint {
  ts: number;
  baseline: number | null;
  predicted: number | null;
}

export function ForecastChart({ points, now, observed, width = 520, height = 168 }: { points: FPoint[]; now: number; observed: number | null; width?: number; height?: number }) {
  const pad = { l: 52, r: 12, t: 14, b: 26 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const t0 = points[0]?.ts ?? now;
  const t1 = points[points.length - 1]?.ts ?? now + 1;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => pad.t + H - ((v - 1) / 2) * H;
  const past = points.filter((p) => p.ts <= now && p.baseline != null);
  const future = points.filter((p) => p.ts >= now && (p.predicted ?? p.baseline) != null);
  const path = (pts: Array<[number, number]>) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const pastLine = path(past.map((p) => [x(p.ts), y(p.baseline!)]));
  const futLine = path(future.map((p) => [x(p.ts), y((p.predicted ?? p.baseline)!)]));
  const ticks = [1, 2, 3];
  const tickName: Record<number, string> = { 1: 'aşağı', 2: 'orta', 3: 'yüksək' };
  const xt = points.filter((_, i) => i % 2 === 0);
  const end = future[future.length - 1];
  return (
    <svg className="fchart" width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sıxlıq proqnozu: keçmiş 2 saatın baza profili və növbəti 1 saatın proqnozu">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="tick">
            {tickName[v]}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={width - pad.r} y1={y(2.4)} y2={y(2.4)} className="ref" />
      <text x={width - pad.r} y={y(2.4) - 4} textAnchor="end" className="ref-label">
        yüksək həddi 2.4
      </text>
      {xt.map((p) => (
        <text key={p.ts} x={x(p.ts)} y={height - 8} textAnchor="middle" className="tick">
          {fmtClock(p.ts)}
        </text>
      ))}
      <path d={pastLine} className="line past" />
      <path d={futLine} className="line future" />
      <line x1={x(now)} x2={x(now)} y1={pad.t} y2={pad.t + H} className="now" />
      <text x={x(now) + 4} y={pad.t + 10} className="now-label">
        indi
      </text>
      {observed != null && <circle cx={x(now)} cy={y(observed)} r={4} className="obs" />}
      {end && (
        <text x={x(end.ts) - 2} y={y((end.predicted ?? end.baseline)!) - 8} textAnchor="end" className="end-label">
          {(end.predicted ?? end.baseline)!.toFixed(1)}
        </text>
      )}
    </svg>
  );
}
