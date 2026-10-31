// Dayanacaq: növbəti avtobuslar. Hər sətir: xətt, istiqamət, sıxlıq — sağda böyük ETA.
// Toxunanda: sıxlığın izahı və bir toxunuşla bildiriş.
import { useEffect, useState } from 'react';
import { ArrowLeft, Lightbulb, Star } from 'lucide-react';
import { api, sendReport, type Arrival, type Arrivals, type Network } from '../api';
import { CrowdGlyph, RouteBadge } from '../components/Crowd';
import { BADGE_TEXT, fmtEta, LEVEL_TEXT } from '../lib/format';
import { distM, fmtDist, getPosition, type Pos } from '../lib/geo';
import { ReportPanel } from './ReportPanel';

export function useArrivals(stopId: string) {
  const [data, setData] = useState<Arrivals | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<Arrivals>(`/api/stops/${stopId}/arrivals`)
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: Error) => alive && setError(e.message));
    setData(null);
    load();
    const t = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [stopId]);
  return { data, error };
}

function crowdLine(a: Arrival) {
  if (a.level == null) return <span className="muted">Sıxlıq bildirilməyib</span>;
  return (
    <span className={`crowd-text lvl-${a.level}`}>
      <CrowdGlyph level={a.level} size={12} /> {LEVEL_TEXT[a.level].label}
      {a.badge !== 'confirmed' && <span className="muted"> · {BADGE_TEXT[a.badge].toLowerCase()}</span>}
    </span>
  );
}

function VerifyPrompt({ a, onClose }: { a: Arrival; onClose: () => void }) {
  const [sent, setSent] = useState<string | null>(null);
  async function answer(yes: boolean) {
    const p = await getPosition(4000);
    try {
      await sendReport({ context: 'bus', busId: a.busId, level: yes ? 'high' : 'low', ...(p ? { lat: p.lat, lon: p.lon, accuracy: p.accuracy } : {}) });
      setSent('Təşəkkürlər! Cavabınız digər sərnişinlərə kömək edəcək.');
    } catch (e) {
      setSent(e instanceof Error ? e.message : 'Göndərmək alınmadı');
    }
    window.setTimeout(onClose, 2500);
  }
  return (
    <div className="callout" role="group" aria-label="Sıxlığı təsdiqləyin">
      <p>
        <strong>{a.label}</strong> haqqında “çox sıx” deyirlər, amma bu hələ təsdiqlənməyib. Bu avtobusdasınız?
      </p>
      {sent ? (
        <p role="status">{sent}</p>
      ) : (
        <div className="row-actions">
          <button type="button" className="btn-dark" onClick={() => answer(true)}>
            Bəli, çox sıxdır
          </button>
          <button type="button" className="btn-soft" onClick={() => answer(false)}>
            Xeyr, yer var
          </button>
          <button type="button" className="btn-plain" onClick={onClose}>
            Bağla
          </button>
        </div>
      )}
    </div>
  );
}

export function StopView({ net, stopId, pos, simple, starred, onStar, onBack, onRoute, onHoverRoute }: { net: Network; stopId: string; pos: Pos | null; simple: boolean; starred?: boolean; onStar?: () => void; onBack: () => void; onRoute: (id: string) => void; onHoverRoute?: (id: string | null) => void }) {
  const { data, error } = useArrivals(stopId);
  const [open, setOpen] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(() => new Set(JSON.parse(sessionStorage.getItem('stb.asked') ?? '[]')));
  const stop = net.stops.find((s) => s.id === stopId)!;
  const color = new Map(net.routes.map((r) => [r.id, r.color]));
  const arrivals = data?.arrivals ?? [];
  const shown = simple ? arrivals.slice(0, 3) : arrivals.slice(0, 8);
  const first = arrivals[0];
  const verify = arrivals.find((a) => a.level === 3 && a.badge === 'check' && !asked.has(a.busId));
  const announce = first ? `Növbəti: ${first.routeId}, ${fmtEta(first.etaS)}${first.level ? ', ' + LEVEL_TEXT[first.level].label : ''}` : '';
  const waiting = Object.entries(data?.stopCrowd ?? {}).filter(([, c]) => c.level != null);

  return (
    <div className="view stop">
      <header className="view-head">
        <button type="button" className="back" onClick={onBack} aria-label="Geri">
          <ArrowLeft size={20} aria-hidden />
        </button>
        <div className="view-title">
          <h1 id="stop-title">{stop.name}</h1>
          <p className="sub">
            {stop.routes.length} xətt
            {pos && ` · ${fmtDist(distM(pos, stop))} uzaqda`}
          </p>
        </div>
        {onStar && (
          <button type="button" className={`star ${starred ? 'on' : ''}`} onClick={onStar} aria-pressed={!!starred} aria-label={starred ? 'Seçilmişlərdən çıxar' : 'Seçilmişlərə əlavə et'}>
            <Star size={20} aria-hidden />
          </button>
        )}
      </header>
      <div className="chips" aria-label="Bu dayanacaqdan keçən xətlər" onMouseLeave={() => onHoverRoute?.(null)}>
        {stop.routes.map((r) => (
          <button key={r} type="button" className="chip-btn" onClick={() => onRoute(r)} onMouseEnter={() => onHoverRoute?.(r)} aria-label={`${r} xəttini aç`}>
            <RouteBadge id={r} color={color.get(r) ?? '#333'} size="sm" />
          </button>
        ))}
      </div>

      {data?.advice && (
        <div className="tip">
          <Lightbulb size={18} aria-hidden />
          <p>{data.advice.text}</p>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {verify && !simple && (
        <VerifyPrompt
          a={verify}
          onClose={() => {
            const n = new Set(asked).add(verify.busId);
            setAsked(n);
            sessionStorage.setItem('stb.asked', JSON.stringify([...n]));
          }}
        />
      )}

      <h2 className="list-title">Gələn avtobuslar</h2>
      {error && <p className="hint err">{error}</p>}
      {!data && !error && (
        <ul className="arrivals" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="sk" />
          ))}
        </ul>
      )}
      {data && (
        <ul className="arrivals">
          {shown.map((a) => {
            const isOpen = open === `${a.busId}-${a.dir}`;
            return (
              <li key={`${a.busId}-${a.dir}`} className={isOpen ? 'open' : ''}>
                <button type="button" className="arr-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : `${a.busId}-${a.dir}`)}>
                  <RouteBadge id={a.routeId} color={a.color} size="lg" />
                  <span className="arr-text">
                    <span className="arr-dest">{a.towards}</span>
                    {crowdLine(a)}
                  </span>
                  <span className="arr-eta">
                    {a.etaS < 45 ? 'indi' : Math.round(a.etaS / 60)}
                    {a.etaS >= 45 && <small>dəq</small>}
                  </span>
                </button>
                {isOpen && (
                  <div className="arr-more">
                    <p className="sub">
                      {a.label}
                      {a.reserve ? ' · ehtiyat avtobus' : ''}
                      {a.bunchedFollower ? ' · öndəki avtobusun ardınca gəlir, adətən boş olur' : ''}
                    </p>
                    <ReportPanel target={{ routeId: a.routeId, busId: a.busId, busLabel: a.label, stopId, stopName: stop.name }} />
                  </div>
                )}
              </li>
            );
          })}
          {!arrivals.length && <li className="empty">Hazırda bu dayanacağa yaxınlaşan avtobus yoxdur.</li>}
        </ul>
      )}

      {!simple && waiting.length > 0 && (
        <p className="hint">
          Dayanacaqda gözləyənlər:{' '}
          {waiting.map(([rid, c], i) => (
            <span key={rid}>
              {i > 0 && ', '}
              {rid} üçün {c.level === 3 ? 'çox adam' : c.level === 2 ? 'orta' : 'az adam'}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
