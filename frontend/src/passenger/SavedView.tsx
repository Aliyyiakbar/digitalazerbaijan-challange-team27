// Seçilmişlər: tez-tez istifadə olunan dayanacaqlarda növbəti avtobuslar bir baxışda, seçilmiş xətlər, son baxılanlar.
import type { ReactNode } from 'react';
import { MapPin, Star } from 'lucide-react';
import type { Network } from '../api';
import { RouteBadge } from '../components/Crowd';
import { fmtEta } from '../lib/format';
import type { Saved } from '../lib/saved';
import { useArrivals } from './StopView';

function SavedStop({ net, id, onStop }: { net: Network; id: string; onStop: (id: string) => void }) {
  const { data, error } = useArrivals(id);
  const stop = net.stops.find((s) => s.id === id);
  if (!stop) return null;
  const next = (data?.arrivals ?? []).slice(0, 3);
  return (
    <li>
      <button type="button" onClick={() => onStop(id)}>
        <Star size={18} aria-hidden className="pin saved" />
        <span className="sl-main">
          <span className="sl-name">{stop.name}</span>
          <span className="sl-routes">
            {next.map((a) => (
              <span key={a.busId} className="next-chip">
                <RouteBadge id={a.routeId} color={a.color} size="sm" /> {fmtEta(a.etaS)}
              </span>
            ))}
            {data && !next.length && <span className="more">Hazırda yaxınlaşan avtobus yoxdur</span>}
            {error && <span className="more">Yenilənmədi</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function SavedView({ net, saved, onStop, onRoute, title = true, children }: { net: Network; saved: Saved; onStop: (id: string) => void; onRoute: (id: string) => void; title?: boolean; children?: ReactNode }) {
  const routes = saved.routes.map((id) => net.routes.find((r) => r.id === id)).filter((r) => r != null);
  const recents = saved.recents.filter((id) => !saved.stops.includes(id)).map((id) => net.stops.find((s) => s.id === id)).filter((s) => s != null);
  const empty = !saved.stops.length && !routes.length;
  return (
    <div className="view saved">
      {title && <h1 className="page-title">Seçilmişlər</h1>}
      {empty && <p className="hint">Hər gün getdiyiniz dayanacaq və xətti açıb ulduza toxunun. Növbəti avtobuslar burada bir baxışda görünəcək.</p>}
      {saved.stops.length > 0 && (
        <section aria-labelledby="saved-stops">
          <h2 id="saved-stops" className="list-title">
            Dayanacaqlar
          </h2>
          <ul className="stop-list">
            {saved.stops.slice(0, 8).map((id) => (
              <SavedStop key={id} net={net} id={id} onStop={onStop} />
            ))}
          </ul>
        </section>
      )}
      {routes.length > 0 && (
        <section aria-labelledby="saved-lines">
          <h2 id="saved-lines" className="list-title">
            Xətlər
          </h2>
          <ul className="result-list">
            {routes.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onRoute(r.id)}>
                  <RouteBadge id={r.id} color={r.color} />
                  <span className="sl-name">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {recents.length > 0 && (
        <section aria-labelledby="recent-stops">
          <h2 id="recent-stops" className="list-title">
            Son baxılanlar
          </h2>
          <ul className="result-list">
            {recents.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onStop(s.id)}>
                  <MapPin size={18} aria-hidden className="pin" />
                  <span className="sl-name">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {children}
    </div>
  );
}
