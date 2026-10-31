// Xətlər: default olaraq yalnız diqqət tələb edənlər (yüksək sıxlıq, proqnoz, tıxac, toplanma, hücum).
// Qalan təfərrüat (sürət, avtobus sayı, bildiriş sayı) xəttin panelindədir.
import { useMemo, useState, type CSSProperties } from 'react';
import { Search } from 'lucide-react';
import type { RouteView } from '../api';
import { CrowdPill, RouteBadge, TrustMark } from '../components/Crowd';
import { CAUSE_TEXT, fmtScore, levelOf } from '../lib/format';

function needsAttention(r: RouteView): boolean {
  return r.crowd.level === 3 || levelOf(r.forecast.p30) === 3 || r.cause.cause === 'traffic' || r.cause.cause === 'mixed' || r.headway.pairs.length > 0 || r.attack.active;
}

export function RouteTable({ routes, selected, onSelect }: { routes: RouteView[]; selected: string | null; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState<'attention' | 'all'>('attention');
  const [q, setQ] = useState('');
  const attention = routes.filter(needsAttention);
  const rows = useMemo(() => {
    const base = q ? routes.filter((r) => r.id.toLowerCase().startsWith(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase())) : mode === 'attention' ? attention : routes;
    return [...base].sort((a, b) => (b.crowd.score ?? 0) - (a.crowd.score ?? 0));
  }, [routes, attention, mode, q]);

  return (
    <>
      <div className="table-tools">
        <div className="tabs" role="tablist" aria-label="Xətlərin süzgəci">
          <button type="button" role="tab" aria-selected={mode === 'attention'} className={mode === 'attention' ? 'on' : ''} onClick={() => setMode('attention')}>
            Diqqət tələb edən {attention.length}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
            Hamısı {routes.length}
          </button>
        </div>
        <label className="tsearch">
          <Search size={14} aria-hidden />
          <span className="sr-only">Xətt axtar</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xətt nömrəsi və ya ad" />
        </label>
      </div>
      <div className="table-wrap">
        <table className="rtable">
          <caption className="sr-only">Xətlər üzrə sıxlıq, etibar, səbəb və proqnoz</caption>
          <thead>
            <tr>
              <th scope="col">Xətt</th>
              <th scope="col">Sıxlıq</th>
              <th scope="col">Etibar</th>
              <th scope="col" className="num">
                Fasiləsiz yüksək
              </th>
              <th scope="col">Səbəb</th>
              <th scope="col" className="num">
                30 dəq sonra
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => {
              const hi = Math.floor(r.highForMs / 60_000);
              return (
                <tr key={r.id} className={selected === r.id ? 'sel' : ''} onClick={() => onSelect(r.id)} style={{ '--i': Math.min(index, 12) } as CSSProperties}>
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
                  <td>
                    <TrustMark badge={r.crowd.badge} confidence={r.crowd.confidence} />
                  </td>
                  <td className={`num ${hi >= 10 ? 'neg' : ''}`}>{hi > 0 ? `${hi} dəq` : '—'}</td>
                  <td className={r.cause.cause === 'traffic' || r.cause.cause === 'mixed' ? 'warn' : ''}>
                    {r.headway.pairs.length ? `${CAUSE_TEXT[r.cause.cause]} · toplanma` : CAUSE_TEXT[r.cause.cause]}
                  </td>
                  <td className={`num ${levelOf(r.forecast.p30) === 3 ? 'neg' : ''}`}>{fmtScore(r.forecast.p30)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="empty">{q ? `“${q}” tapılmadı.` : 'Hazırda diqqət tələb edən xətt yoxdur.'}</p>}
      </div>
    </>
  );
}
