// Ana görünüş: "Haraya gedirsiniz?", yaxınlıqdakı dayanacaqlar (məsafə ilə), xətlər.
import { ChevronRight, LocateFixed, MapPin, Navigation } from 'lucide-react';
import type { Network } from '../api';
import { RouteBadge } from '../components/Crowd';
import { distM, fmtDist, walkMin, type LocStatus, type Pos } from '../lib/geo';

export function HomeView({ net, pos, locStatus, onLocate, onStop, onRoute, onPlan }: { net: Network; pos: Pos | null; locStatus: LocStatus; onLocate: () => void; onStop: (id: string) => void; onRoute: (id: string) => void; onPlan: () => void }) {
  const color = new Map(net.routes.map((r) => [r.id, r.color]));
  const nearby = pos
    ? net.stops
        .map((s) => ({ s, d: distM(pos, s) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
    : null;
  const hubs = [...net.stops].sort((a, b) => b.routes.length - a.routes.length).slice(0, 6);
  const list = nearby ?? hubs.map((s) => ({ s, d: null as number | null }));

  return (
    <div className="view home">
      <button type="button" className="plan-entry" onClick={onPlan}>
        <Navigation size={18} aria-hidden />
        <span>Haraya gedirsiniz?</span>
        <ChevronRight size={18} aria-hidden className="push" />
      </button>

      <section aria-labelledby="near-title">
        <div className="sec-head">
          <h2 id="near-title">{nearby ? 'Yaxınlıqdakı dayanacaqlar' : 'Əsas dayanacaqlar'}</h2>
          {!nearby && (
            <button type="button" className="link-btn" onClick={onLocate} disabled={locStatus === 'locating'}>
              <LocateFixed size={15} aria-hidden /> {locStatus === 'locating' ? 'Axtarılır…' : 'Yaxınlıqdakıları göstər'}
            </button>
          )}
        </div>
        {locStatus === 'denied' && <p className="hint">Yer icazəsi verilməyib. Brauzerin ünvan zolağındakı kilid işarəsindən icazə verə bilərsiniz.</p>}
        {locStatus === 'unavailable' && <p className="hint">Yer təyini yalnız HTTPS və ya localhost ünvanında işləyir.</p>}
        <ul className="stop-list">
          {list.map(({ s, d }) => (
            <li key={s.id}>
              <button type="button" onClick={() => onStop(s.id)}>
                <MapPin size={18} aria-hidden className="pin" />
                <span className="sl-main">
                  <span className="sl-name">{s.name}</span>
                  <span className="sl-routes">
                    {s.routes.slice(0, 7).map((r) => (
                      <RouteBadge key={r} id={r} color={color.get(r) ?? '#333'} size="sm" />
                    ))}
                    {s.routes.length > 7 && <span className="more">+{s.routes.length - 7}</span>}
                  </span>
                </span>
                {d != null && (
                  <span className="sl-dist">
                    {fmtDist(d)}
                    <small>{walkMin(d)}</small>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="lines-title">
        <div className="sec-head">
          <h2 id="lines-title">Xətlər</h2>
          <span className="count">{net.routes.length} xətt canlı</span>
        </div>
        <div className="route-grid">
          {net.routes.map((r) => (
            <button key={r.id} type="button" className="route-tile" style={{ ['--route' as string]: r.color }} onClick={() => onRoute(r.id)} aria-label={`${r.id}: ${r.name}`}>
              {r.id}
            </button>
          ))}
        </div>
      </section>
      <p className="source">
        Xətlər, dayanacaqlar və gündəlik gedişlər: <a href="https://opendata.az" target="_blank" rel="noreferrer">opendata.az</a> (AYNA, Bakı Metropoliteni). Avtobusların hərəkəti simulyasiyadır.
      </p>
    </div>
  );
}
