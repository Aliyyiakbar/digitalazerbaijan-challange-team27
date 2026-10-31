// Xətlər: axtarış, növ süzgəci, sıralama. Sıxlıq canlıdır, gediş sayı real açıq məlumatdır.
import { useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import type { LiveState, Network } from '../api';
import { CrowdPill, RouteBadge } from '../components/Crowd';
import { fmtInt } from '../lib/format';
import { norm } from './SearchView';

type Kind = 'all' | 'regular' | 'express' | 'saved';
type Sort = 'number' | 'ridership' | 'crowd';
const KINDS: Array<[Kind, string]> = [
  ['all', 'Hamısı'],
  ['regular', 'Adi'],
  ['express', 'Ekspres'],
  ['saved', 'Seçilmiş'],
];
const SORTS: Array<[Sort, string]> = [
  ['number', 'Nömrə'],
  ['ridership', 'Gediş sayı'],
  ['crowd', 'Sıxlıq'],
];

export function LinesView({ net, live, savedRoutes, onRoute, onHover, title = true }: { net: Network; live: LiveState | null; savedRoutes: string[]; onRoute: (id: string) => void; onHover?: (id: string | null) => void; title?: boolean }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('number');
  const crowd = useMemo(() => new Map((live?.routes ?? []).map((r) => [r.id, r.crowd])), [live]);
  const nq = norm(q.trim());
  const rows = useMemo(() => {
    const list = net.routes.filter((r) => (kind === 'all' || (kind === 'saved' ? savedRoutes.includes(r.id) : r.kind === kind)) && (!nq || norm(r.id).startsWith(nq) || norm(r.name).includes(nq)));
    if (sort === 'ridership') return [...list].sort((a, b) => b.ridership.recentDaily - a.ridership.recentDaily);
    if (sort === 'crowd') return [...list].sort((a, b) => (crowd.get(b.id)?.score ?? 0) * Math.min(1, (crowd.get(b.id)?.n ?? 0) / 5) - (crowd.get(a.id)?.score ?? 0) * Math.min(1, (crowd.get(a.id)?.n ?? 0) / 5));
    return list;
  }, [net, kind, savedRoutes, nq, sort, crowd]);

  return (
    <div className="view lines">
      {title && <h1 className="page-title">Xətlər</h1>}
      <label className="filter-box">
        <Search size={16} aria-hidden />
        <span className="sr-only">Xətt axtar</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nömrə və ya dayanacaq adı" autoComplete="off" enterKeyHint="search" />
      </label>
      <div className="filter-row">
        <div className="pill-group" role="radiogroup" aria-label="Xətt növü">
          {KINDS.map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {t}
            </button>
          ))}
        </div>
        <label className="sort-box">
          <span className="sr-only">Sıralama</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="line-list" onMouseLeave={() => onHover?.(null)}>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onRoute(r.id)} onMouseEnter={() => onHover?.(r.id)} onFocus={() => onHover?.(r.id)} aria-label={`${r.id}: ${r.name}`}>
              <RouteBadge id={r.id} color={r.color} />
              <span className="ll-main">
                <span className="ll-name">
                  {savedRoutes.includes(r.id) && <Star size={12} aria-hidden className="ll-star" />}
                  {r.name}
                </span>
                <span className="ll-meta">
                  hər {r.headwayMin} dəq · gündə {fmtInt(r.ridership.recentDaily)} gediş
                </span>
              </span>
              <CrowdPill level={crowd.get(r.id)?.level ?? null} compact />
            </button>
          </li>
        ))}
        {!rows.length && <li className="hint">{kind === 'saved' && !nq ? 'Hələ seçilmiş xətt yoxdur. Xətti açıb ulduza toxunun.' : `“${q}” üzrə xətt tapılmadı.`}</li>}
      </ul>
      <p className="source">Gediş sayı: son 30 gün, BakuBus, opendata.az. İntervallar gediş sayından hesablanıb, rəsmi cədvəl deyil.</p>
    </div>
  );
}
