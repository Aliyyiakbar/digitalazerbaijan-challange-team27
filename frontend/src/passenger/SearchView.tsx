// Axtarış: dayanacaqlar və xətlər. Azərbaycan hərfləri ilə və onlarsız yazılışı tanıyır (ə→e, ş→s ...).
import { useMemo, useState } from 'react';
import { ArrowLeft, MapPin } from 'lucide-react';
import type { Network } from '../api';
import { RouteBadge } from '../components/Crowd';

export const norm = (s: string) =>
  s
    .toLocaleLowerCase('az')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');

export function SearchView({ net, onClose, onStop, onRoute }: { net: Network; onClose: () => void; onStop: (id: string) => void; onRoute: (id: string) => void }) {
  const [q, setQ] = useState('');
  const color = new Map(net.routes.map((r) => [r.id, r.color]));
  const nq = norm(q.trim());
  const routes = useMemo(() => (nq ? net.routes.filter((r) => norm(r.id).startsWith(nq) || norm(r.name).includes(nq)).slice(0, 8) : []), [net, nq]);
  const stops = useMemo(() => (nq.length >= 2 ? net.stops.filter((s) => norm(s.name).includes(nq)).slice(0, 30) : []), [net, nq]);

  return (
    <div className="view search">
      <div className="search-bar active">
        <button type="button" className="back" onClick={onClose} aria-label="Bağla">
          <ArrowLeft size={20} aria-hidden />
        </button>
        <label className="sr-only" htmlFor="q">
          Dayanacaq və ya xətt
        </label>
        <input id="q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dayanacaq və ya xətt nömrəsi" autoComplete="off" enterKeyHint="search" />
      </div>
      {!nq && <p className="hint">Məsələn: “28 May”, “Gənclik”, “14”.</p>}
      {routes.length > 0 && (
        <>
          <h2 className="list-title">Xətlər</h2>
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
        </>
      )}
      {stops.length > 0 && (
        <>
          <h2 className="list-title">Dayanacaqlar</h2>
          <ul className="result-list">
            {stops.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onStop(s.id)}>
                  <MapPin size={18} aria-hidden className="pin" />
                  <span className="sl-main">
                    <span className="sl-name">{s.name}</span>
                    <span className="sl-routes">
                      {s.routes.slice(0, 6).map((r) => (
                        <RouteBadge key={r} id={r} color={color.get(r) ?? '#333'} size="sm" />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {nq.length >= 2 && !routes.length && !stops.length && <p className="hint">“{q}” tapılmadı.</p>}
    </div>
  );
}
