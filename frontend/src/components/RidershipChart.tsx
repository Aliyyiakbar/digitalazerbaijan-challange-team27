// Real məlumat: xətt üzrə gündəlik gedişlər (BakuBus validasiyaları, opendata.az). Bir seriya, düz künclü sütunlar.
export function RidershipChart({ series, width = 460, height = 150 }: { series: Array<[string, number]>; width?: number; height?: number }) {
  if (!series.length) return null;
  const pad = { l: 46, r: 8, t: 10, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const max = Math.max(...series.map(([, v]) => v));
  const step = max > 20000 ? 10000 : max > 8000 ? 5000 : max > 3000 ? 2000 : 1000;
  const top = Math.ceil((max * 1.05) / step) * step;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const bw = W / series.length;
  const y = (v: number) => pad.t + H - (v / top) * H;
  const labelIdx = [0, Math.floor(series.length / 2), series.length - 1];
  return (
    <svg className="rchart" width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Son ${series.length} günün gündəlik gedişləri, ən çox ${max.toLocaleString('az')}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        </g>
      ))}
      {series.map(([d, v], i) => (
        <rect key={d} x={pad.l + i * bw + 0.5} y={y(v)} width={Math.max(1, bw - 1)} height={pad.t + H - y(v)} className="bar">
          <title>
            {d.split('-').reverse().join('.')}: {v.toLocaleString('az')} gediş
          </title>
        </rect>
      ))}
      {labelIdx.map((i) => (
        <text key={i} x={pad.l + i * bw + bw / 2} y={height - 6} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} className="tick">
          {series[i][0].split('-').reverse().join('.')}
        </text>
      ))}
    </svg>
  );
}
