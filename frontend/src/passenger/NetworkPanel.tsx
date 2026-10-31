// Masaüstünün sağ paneli: şəbəkənin indiki vəziyyəti. Xəritəyə baxarkən nəyin vacib olduğunu göstərir.
import { useMemo } from 'react';
import { ChevronRight, PanelRightClose } from 'lucide-react';
import type { LiveState, Network } from '../api';
import { CrowdPill, RouteBadge } from '../components/Crowd';
import { fmtClock, fmtInt } from '../lib/format';

export function NetworkPanel({ net, live, connected, onRoute, onHover, onClose }: { net: Network; live: LiveState | null; connected: boolean; onRoute: (id: string) => void; onHover: (id: string | null) => void; onClose: () => void }) {
  const routes = useMemo(() => live?.routes ?? [], [live]);
  const counts = useMemo(() => {
    const c = { 1: 0, 2: 0, 3: 0, none: 0 };
    for (const r of routes) c[r.crowd.level ?? 'none']++;
    return c;
  }, [routes]);
  // 1-2 bildirişli "yüksək" 40 bildirişli xəttin üstünə çıxmasın (qayda ≥5 bildiriş tələb edir)
  const busiest = useMemo(() => {
    const weight = (r: (typeof routes)[number]) => ((r.crowd.score ?? 1) - 1) * Math.min(1, r.crowd.n / 5);
    return [...routes].filter((r) => r.crowd.level != null && r.crowd.n >= 3).sort((a, b) => weight(b) - weight(a)).slice(0, 6);
  }, [routes]);
  const topRidership = useMemo(() => [...net.routes].sort((a, b) => b.ridership.recentDaily - a.ridership.recentDaily).slice(0, 5), [net]);
  const total = routes.length || 1;

  return (
    <aside className="net-panel" aria-label="Şəbəkənin vəziyyəti">
      <header className="np-head">
        <h2>İndi şəbəkədə</h2>
        <span className={`conn ${connected ? 'ok' : ''}`}>{live ? fmtClock(live.now) : 'Qoşulur…'}</span>
        <button type="button" className="np-close" onClick={onClose} aria-label="Paneli gizlət">
          <PanelRightClose size={18} aria-hidden />
        </button>
      </header>

      <p className="np-line">
        <strong>{live?.buses.length ?? 0}</strong> avtobus, <strong>{routes.length || net.routes.length}</strong> xətt, <strong>{net.stops.length}</strong> dayanacaq
      </p>

      <div className="np-bar" role="img" aria-label={`Xətlər üzrə sıxlıq: ${counts[1]} aşağı, ${counts[2]} orta, ${counts[3]} yüksək, ${counts.none} bildirişsiz`}>
        <i className="b1" style={{ flexBasis: `${(counts[1] / total) * 100}%` }} />
        <i className="b2" style={{ flexBasis: `${(counts[2] / total) * 100}%` }} />
        <i className="b3" style={{ flexBasis: `${(counts[3] / total) * 100}%` }} />
        <i className="b0" style={{ flexBasis: `${(counts.none / total) * 100}%` }} />
      </div>
      <dl className="np-legend">
        <div>
          <dt className="d1">Yer var</dt>
          <dd>{counts[1]}</dd>
        </div>
        <div>
          <dt className="d2">Orta</dt>
          <dd>{counts[2]}</dd>
        </div>
        <div>
          <dt className="d3">Çox sıx</dt>
          <dd>{counts[3]}</dd>
        </div>
        <div>
          <dt className="d0">Bildiriş yox</dt>
          <dd>{counts.none}</dd>
        </div>
      </dl>

      <h3>Ən sıx xətlər</h3>
      {busiest.length ? (
        <ul className="np-list" onMouseLeave={() => onHover(null)}>
          {busiest.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onRoute(r.id)} onMouseEnter={() => onHover(r.id)} onFocus={() => onHover(r.id)} aria-label={`${r.id} xəttini aç`}>
                <RouteBadge id={r.id} color={r.color} size="sm" />
                <CrowdPill level={r.crowd.level} />
                <span className="np-n">{r.crowd.n} bildiriş</span>
                <ChevronRight size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Hələ kifayət qədər bildiriş yoxdur.</p>
      )}

      <h3>Ən çox gediş olan xətlər</h3>
      <ul className="np-list" onMouseLeave={() => onHover(null)}>
        {topRidership.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onRoute(r.id)} onMouseEnter={() => onHover(r.id)} onFocus={() => onHover(r.id)} aria-label={`${r.id} xəttini aç`}>
              <RouteBadge id={r.id} color={r.color} size="sm" />
              <span className="np-n push">{fmtInt(r.ridership.recentDaily)} gediş/gün</span>
              <ChevronRight size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <p className="source">
        Real: xətlər, dayanacaqlar, gediş sayı (opendata.az). Simulyasiya: avtobusların yeri, sıxlıq bildirişləri. <a href="/operator">Dispetçer paneli</a>
      </p>
    </aside>
  );
}
