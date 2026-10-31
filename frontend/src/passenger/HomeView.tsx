// Ana görünüş: "Haraya gedirsiniz?", yaxınlıqdakı dayanacaqlar (məsafə ilə), xətlər.
import { ChevronRight, LocateFixed, MapPin, Navigation } from 'lucide-react';
import type { Network } from '../api';
import { RouteBadge } from '../components/Crowd';
import { distM, fmtDist, locationStatusMessage, walkMin, type LocStatus, type Pos } from '../lib/geo';

export function HomeView({ net, pos, locStatus, compact, onLocate, onStop, onRoute, onPlan }: { net: Network; pos: Pos | null; locStatus: LocStatus; compact?: boolean; onLocate: () => void; onStop: (id: string) => void; onRoute: (id: string) => void; onPlan: () => void }) {
  const color = new Map(net.routes.map((r) => [r.id, r.color]));
  const nearby = pos
    ? net.stops
        .map((s) => ({ s, d: distM(pos, s) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
    : null;
  const hubs = [...net.stops].sort((a, b) => b.routes.length - a.routes.length).slice(0, 6);
  const list = nearby ?? hubs.map((s) => ({ s, d: null as number | null }));
  const locationMessage = locationStatusMessage(locStatus);
  const locating = locStatus === 'locating';

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
            <button type="button" className="link-btn" onClick={onLocate} disabled={locating} aria-busy={locating}>
              <LocateFixed size={15} aria-hidden className={locating ? 'locate-spin' : undefined} />
              <span>{locating ? 'Axtarılır…' : locationMessage ? 'Yenidən cəhd et' : 'Yaxınlıqdakıları göstər'}</span>
            </button>
          )}
        </div>
        {locationMessage && <p className="hint location-error" role="status">{locationMessage}</p>}
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

      {!compact && (
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
      )}
      <p className="source">
        Xətlər, dayanacaqlar və gündəlik gedişlər: <a href="https://opendata.az" target="_blank" rel="noreferrer">opendata.az</a> (AYNA, Bakı Metropoliteni). Avtobusların hərəkəti simulyasiyadır.
      </p>
    </div>
  );
}
