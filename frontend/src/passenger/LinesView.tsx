// Xətt seçildikdə: avtobusların canlı yerləşməsi və hər birinin sıxlığı.
import type { BusView, LiveState, Network } from '../api';
import { CrowdPill, RouteBadge, TrustMark } from '../components/Crowd';

export function LinesView({ net, live, routeId, setRouteId }: { net: Network; live: LiveState | null; routeId: string; setRouteId: (id: string) => void }) {
  const route = net.routes.find((r) => r.id === routeId)!;
  const buses: BusView[] = (live?.buses ?? []).filter((b) => b.routeId === routeId).sort((a, b) => a.d - b.d);
  const rv = live?.routes.find((r) => r.id === routeId);
  const stopName = (id: string) => net.stops.find((s) => s.id === id)?.name ?? id;
  return (
    <section className="lines" aria-labelledby="line-title">
      <div className="line-chips" role="radiogroup" aria-label="Xətt seçin">
        {net.routes.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={r.id === routeId} className={r.id === routeId ? 'on' : ''} onClick={() => setRouteId(r.id)}>
            {r.id}
          </button>
        ))}
      </div>
      <header className="stop-head">
        <h1 id="line-title">
          <RouteBadge id={route.id} color={route.color} size="lg" /> {route.name}
        </h1>
        <p className="finding">
          {buses.length} avtobus xətdədir
          {rv?.crowd.level ? ` · xətt üzrə sıxlıq: ${rv.crowd.level === 3 ? 'yüksək' : rv.crowd.level === 2 ? 'orta' : 'aşağı'}` : ''}
          {rv?.cause.cause === 'traffic' ? ' · yolda tıxac var' : ''}
        </p>
        <p className="fine">{route.stopIds.map(stopName).join(' · ')}</p>
      </header>
      <ul className="bus-list">
        {buses.map((b) => (
          <li key={b.id}>
            <span className="bl-label">{b.label}</span>
            <span className="bl-to">
              {b.towards} istiqamətində · {b.speedKmh} km/s
              {b.bunchedFollower && <span className="bl-note"> · öndəki avtobusun ardınca gedir, adətən boş olur</span>}
              {b.reserve && <span className="bl-note"> · ehtiyat avtobus</span>}
            </span>
            <CrowdPill level={b.crowd.level} />
            <TrustMark badge={b.crowd.badge} confidence={b.crowd.confidence} showText={false} />
          </li>
        ))}
        {!buses.length && <li className="empty">Canlı məlumat gözlənilir…</li>}
      </ul>
    </section>
  );
}
