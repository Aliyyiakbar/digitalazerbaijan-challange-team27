// Xətlər üzrə sıxlıq siyahısı: ən yüklü xətt birinci.
import type { RouteView } from '../api';
import { CrowdPill, RouteBadge, TrustMark } from '../components/Crowd';
import { CAUSE_TEXT, fmtScore, levelOf } from '../lib/format';

export function RouteTable({ routes, selected, onSelect }: { routes: RouteView[]; selected: string | null; onSelect: (id: string) => void }) {
  const sorted = [...routes].sort((a, b) => (b.crowd.score ?? 0) - (a.crowd.score ?? 0));
  return (
    <div className="table-wrap">
      <table className="rtable">
        <caption className="sr-only">Xətlər üzrə sıxlıq, etibar, səbəb və proqnoz</caption>
        <thead>
          <tr>
            <th scope="col">Xətt</th>
            <th scope="col">Sıxlıq</th>
            <th scope="col" className="num">
              Bal
            </th>
            <th scope="col">Etibar</th>
            <th scope="col" className="num">
              Yüksək
            </th>
            <th scope="col" className="num">
              Avtobus
            </th>
            <th scope="col">Səbəb</th>
            <th scope="col" className="num">
              Sürət
            </th>
            <th scope="col" className="num">
              Toplanma
            </th>
            <th scope="col" className="num">
              30 dəq sonra
            </th>
            <th scope="col" className="num">
              Bildiriş
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const hi = Math.floor(r.highForMs / 60_000);
            return (
              <tr key={r.id} className={selected === r.id ? 'sel' : ''} onClick={() => onSelect(r.id)}>
                <th scope="row">
                  <button type="button" className="row-btn" onClick={() => onSelect(r.id)} aria-label={`${r.id} xəttinin təfərrüatı`}>
                    <RouteBadge id={r.id} color={r.color} size="sm" />
                    <span className="rname">{r.name}</span>
                  </button>
                </th>
                <td>
                  <CrowdPill level={r.crowd.level} />
                  {r.attack.active && <span className="tag-neg">hücum</span>}
                </td>
                <td className="num">{fmtScore(r.crowd.score)}</td>
                <td>
                  <TrustMark badge={r.crowd.badge} confidence={r.crowd.confidence} />
                </td>
                <td className={`num ${hi >= 10 ? 'neg' : ''}`}>{hi > 0 ? `${hi} dəq` : '—'}</td>
                <td className="num">
                  {r.buses}
                  <span className="sub">/{r.plannedBuses}</span>
                </td>
                <td className={r.cause.cause === 'traffic' || r.cause.cause === 'mixed' ? 'warn' : ''}>{CAUSE_TEXT[r.cause.cause]}</td>
                <td className="num">
                  {r.speedKmh ?? '—'}
                  <span className="sub"> km/s</span>
                </td>
                <td className="num">{r.headway.pairs.length ? `${r.headway.pairs.length} cüt` : '—'}</td>
                <td className={`num ${levelOf(r.forecast.p30) === 3 ? 'neg' : ''}`}>{fmtScore(r.forecast.p30)}</td>
                <td className="num">{r.crowd.n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
