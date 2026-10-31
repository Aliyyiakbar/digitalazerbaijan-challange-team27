// Dayanacaq: növbəti avtobuslar, ETA, sıxlıq, etibar; "bunu burax" tövsiyəsi; bildiriş.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LocateFixed, Search, SkipForward } from 'lucide-react';
import { api, sendReport, type Arrival, type Arrivals, type Network } from '../api';
import { CrowdPill, RouteBadge, TrustMark } from '../components/Crowd';
import { fmtEta, LEVEL_TEXT } from '../lib/format';
import { distM, getPosition } from '../lib/geo';
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

export function StopPicker({ net, value, onChange }: { net: Network; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const norm = (s: string) => s.toLocaleLowerCase('az').replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
  const list = useMemo(() => net.stops.filter((s) => !q || norm(s.name).includes(norm(q))).sort((a, b) => a.name.localeCompare(b.name, 'az')), [net, q]);

  async function nearest() {
    setLocating(true);
    setMsg(null);
    const p = await getPosition(8000);
    setLocating(false);
    if (!p) return setMsg('Yerinizi müəyyən etmək alınmadı. Brauzerdə icazə verin və ya dayanacağı siyahıdan seçin.');
    const best = [...net.stops].sort((a, b) => distM(p, a) - distM(p, b))[0];
    const d = distM(p, best);
    onChange(best.id);
    if (d > 3000) setMsg(`Ən yaxın dayanacaq ${(d / 1000).toFixed(1)} km uzaqdadır: ${best.name}.`);
  }

  return (
    <div className="stop-picker">
      <div className="sp-row">
        <label className="sp-search">
          <Search size={16} aria-hidden />
          <span className="sr-only">Dayanacaq axtar</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Dayanacaq axtar"
            aria-expanded={open}
            aria-controls="stop-list"
            role="combobox"
            autoComplete="off"
          />
        </label>
        <button type="button" className="btn-ghost" onClick={nearest} disabled={locating}>
          <LocateFixed size={16} aria-hidden />
          {locating ? 'Axtarılır…' : 'Mənə yaxın'}
        </button>
      </div>
      {msg && (
        <p className="fine" role="status">
          {msg}
        </p>
      )}
      {open && (
        <ul id="stop-list" className="sp-list" role="listbox" aria-label="Dayanacaqlar">
          {list.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span>{s.name}</span>
                <span className="sp-routes">{s.routes.join(' · ')}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="fine">"{q}" adlı dayanacaq yoxdur</li>}
        </ul>
      )}
    </div>
  );
}

function ArrivalRow({ a, open, onToggle, stopId, stopName }: { a: Arrival; open: boolean; onToggle: () => void; stopId: string; stopName: string }) {
  return (
    <li className={`arr ${open ? 'open' : ''}`}>
      <button type="button" className="arr-main" onClick={onToggle} aria-expanded={open}>
        <RouteBadge id={a.routeId} color={a.color} />
        <span className="arr-to">
          <span className="arr-towards">{a.towards} istiqamətində</span>
          <span className="arr-meta">
            {a.label}
            {a.reserve && ' · ehtiyat avtobus'}
            {a.bunchedFollower && ' · öndəki avtobusun ardınca gəlir'}
          </span>
        </span>
        <span className="arr-crowd">
          <CrowdPill level={a.level} />
          <TrustMark badge={a.badge} confidence={a.confidence} showText={false} />
        </span>
        <span className="arr-eta" aria-label={`${fmtEta(a.etaS)} sonra`}>
          {fmtEta(a.etaS)}
        </span>
        <ChevronDown size={16} className="chev" aria-hidden />
      </button>
      {open && (
        <div className="arr-detail">
          <p className="arr-explain">
            {a.level ? LEVEL_TEXT[a.level].long : 'Bu avtobus üçün son 10 dəqiqədə bildiriş yoxdur.'}
            {a.badge === 'check' && ' Bildirişlər hələ tam təsdiqlənməyib.'}
            {a.badge === 'suspicious' && ' Bildirişlər şübhəlidir, sistem onları az nəzərə alır.'}
          </p>
          <ReportPanel target={{ routeId: a.routeId, busId: a.busId, busLabel: a.label, stopId, stopName }} />
        </div>
      )}
    </li>
  );
}

/** Aktiv yoxlama: etibarı az olan "çox sıx" bildirişini yaxındakı sərnişindən soruş. */
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
    <div className="verify" role="group" aria-label="Sıxlığı təsdiqləyin">
      <p>
        <strong>{a.label}</strong> haqqında “çox sıx” deyilir, amma bu hələ təsdiqlənməyib. Bu avtobusdasınızsa, doğrudurmu?
      </p>
      {sent ? (
        <p role="status">{sent}</p>
      ) : (
        <div className="verify-actions">
          <button type="button" className="btn-dark" onClick={() => answer(true)}>
            Bəli, çox sıxdır
          </button>
          <button type="button" className="btn-ghost" onClick={() => answer(false)}>
            Xeyr, yer var
          </button>
          <button type="button" className="btn-link" onClick={onClose}>
            Bu avtobusda deyiləm
          </button>
        </div>
      )}
    </div>
  );
}

export function ArrivalsView({ net, stopId, onStop, simple }: { net: Network; stopId: string; onStop: (id: string) => void; simple: boolean }) {
  const { data, error } = useArrivals(stopId);
  const [open, setOpen] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(() => new Set(JSON.parse(sessionStorage.getItem('stb.asked') ?? '[]')));
  const stop = net.stops.find((s) => s.id === stopId)!;
  const arrivals = data?.arrivals ?? [];
  const shown = simple ? arrivals.slice(0, 3) : arrivals;
  const first = arrivals[0];
  const verify = arrivals.find((a) => a.level === 3 && a.badge === 'check' && !asked.has(a.busId));

  // ekran oxuyucu üçün: mətn yalnız dəqiqə və ya avtobus dəyişəndə dəyişir, aria-live nəzakətlə elan edir
  const announce = first ? `Növbəti: ${first.routeId}, ${fmtEta(first.etaS)}${first.level ? ', ' + LEVEL_TEXT[first.level].label : ''}` : '';

  const stopCrowd = Object.entries(data?.stopCrowd ?? {}).filter(([, c]) => c.level != null);

  return (
    <section className="arrivals" aria-labelledby="stop-title">
      <StopPicker net={net} value={stopId} onChange={onStop} />
      <header className="stop-head">
        <h1 id="stop-title">{stop.name}</h1>
        <p className="finding">
          {error
            ? error
            : !data
              ? 'Gəlişlər yüklənir…'
              : data.advice
                ? data.advice.text
                : first
                  ? `Növbəti avtobus: ${first.routeId}, ${fmtEta(first.etaS)}${first.level === 3 ? ', amma çox sıxdır' : ''}.`
                  : 'Hazırda bu dayanacağa yaxınlaşan avtobus yoxdur.'}
        </p>
        {data?.advice && (
          <p className="advice">
            <SkipForward size={16} aria-hidden /> {data.advice.certain ? 'Tövsiyə' : 'Ehtimal'}: növbəti avtobusu gözləsəniz, rahat gedəcəksiniz.
          </p>
        )}
      </header>
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

      {!data && !error && (
        <ul className="arr-list skeleton" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="arr sk" />
          ))}
        </ul>
      )}
      {data && (
        <ul className="arr-list">
          {shown.map((a) => (
            <ArrivalRow key={`${a.busId}-${a.dir}`} a={a} open={open === a.busId} onToggle={() => setOpen(open === a.busId ? null : a.busId)} stopId={stopId} stopName={stop.name} />
          ))}
          {!arrivals.length && <li className="empty">Bu dayanacaqdan keçən xətlər: {stop.routes.join(', ')}. Avtobus yaxınlaşanda burada görünəcək.</li>}
        </ul>
      )}

      {!simple && (
        <div className="stop-crowd">
          <h2>Dayanacaqda gözləyənlər</h2>
          {stopCrowd.length ? (
            <ul>
              {stopCrowd.map(([rid, c]) => (
                <li key={rid}>
                  <span>{rid} gözləyənlər</span>
                  <CrowdPill level={c.level} />
                  <span className="fine">{c.n} bildiriş</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fine">Son 10 dəqiqədə bu dayanacaq üçün bildiriş yoxdur. Dayanacaqdasınızsa, istənilən avtobusu açıb “Dayanacaqda gözləyirəm” seçin.</p>
          )}
        </div>
      )}
    </section>
  );
}
