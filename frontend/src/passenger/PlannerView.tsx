// "Haradan → Haraya": sıxlığı nəzərə alan marşrut planı. Variantlar hiss olunan vaxta görə sıralanır.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowLeft, Circle, MapPin } from 'lucide-react';
import { api, type Journey, type Network, type PlanResult } from '../api';
import { RouteBadge } from '../components/Crowd';
import { fmtMin, LEVEL_TEXT } from '../lib/format';
import { distM, type Pos } from '../lib/geo';
import { norm } from './SearchView';

function StopField({ net, label, value, onChange, icon }: { net: Network; label: string; value: string | null; onChange: (id: string) => void; icon: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const name = net.stops.find((s) => s.id === value)?.name ?? '';
  const nq = norm(q.trim());
  const hits = useMemo(() => (nq.length >= 2 ? net.stops.filter((s) => norm(s.name).includes(nq)).slice(0, 8) : []), [net, nq]);
  return (
    <div className="field">
      {icon}
      {editing ? (
        <input
          autoFocus
          aria-label={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => window.setTimeout(() => setEditing(false), 150)}
          placeholder={label}
        />
      ) : (
        <button type="button" className={`field-btn ${value ? '' : 'ph'}`} onClick={() => setEditing(true)}>
          {name || label}
        </button>
      )}
      {editing && hits.length > 0 && (
        <ul className="field-pop" role="listbox" aria-label={label}>
          {hits.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.id);
                  setEditing(false);
                  setQ('');
                }}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlannerView({ net, pos, from, setFrom, onBack, onJourney, showHead = true }: { net: Network; pos: Pos | null; from: string | null; setFrom: (id: string) => void; onBack: () => void; onJourney?: (j: Journey | null) => void; showHead?: boolean }) {
  const [to, setTo] = useState<string | null>(() => localStorage.getItem('stb.to'));
  const [res, setRes] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(0);

  // Canlı yenilənmədə seçilmiş variant xəritədə qalsın; xətt tərkibi dəyişəndə birinciyə qayıt
  const journey = res?.journeys[picked] ?? res?.journeys[0] ?? null;
  const journeyKey = journey ? journey.legs.map((l) => `${l.routeId}:${l.fromStopId}:${l.toStopId}`).join() : '';
  useEffect(() => {
    onJourney?.(journey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyKey]);
  useEffect(() => setPicked(0), [from, to]);

  useEffect(() => {
    if (!from && pos) setFrom([...net.stops].sort((a, b) => distM(pos, a) - distM(pos, b))[0].id);
  }, [pos, from, net, setFrom]);

  useEffect(() => {
    if (to) localStorage.setItem('stb.to', to);
    setRes(null);
    setError(null);
    if (!from || !to) return;
    if (from === to) return setError('Başlanğıc və son dayanacaq fərqli olmalıdır.');
    let alive = true;
    const load = () =>
      api
        .get<PlanResult>(`/api/plan?from=${from}&to=${to}`)
        .then((r) => alive && setRes(r))
        .catch((e: Error) => alive && setError(e.message));
    load();
    const t = window.setInterval(load, 6000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [from, to]);

  const fastest = res?.journeys.length ? Math.min(...res.journeys.map((j) => j.totalS)) : null;

  return (
    <div className="view plan">
      {showHead ? (
        <header className="view-head">
          <button type="button" className="back" onClick={onBack} aria-label="Geri">
            <ArrowLeft size={20} aria-hidden />
          </button>
          <h1 id="plan-title">Marşrut planı</h1>
        </header>
      ) : (
        <h1 id="plan-title" className="page-title">
          Marşrut planı
        </h1>
      )}
      <div className="od">
        <div className="od-fields">
          <StopField net={net} label="Haradan" value={from} onChange={setFrom} icon={<Circle size={14} aria-hidden className="od-ico" />} />
          <StopField net={net} label="Haraya" value={to} onChange={setTo} icon={<MapPin size={16} aria-hidden className="od-ico" />} />
        </div>
        <button
          type="button"
          className="btn-round"
          aria-label="Yerlərini dəyiş"
          onClick={() => {
            if (!from || !to) return;
            const f = from;
            setFrom(to);
            setTo(f);
          }}
        >
          <ArrowDownUp size={18} aria-hidden />
        </button>
      </div>

      {error && <p className="hint err">{error}</p>}
      {!to && <p className="hint">Hara getmək istədiyinizi yazın. Variantları sərnişinlərin bildirdiyi sıxlığa görə sıralayacağıq.</p>}
      {res && !res.journeys.length && <p className="hint">Bu iki dayanacaq arasında ən çox bir köçürmə ilə gedən variant tapılmadı.</p>}
      <ol className="journeys">
        {res?.journeys.map((j, i) => (
          <li key={i} className={`journey ${i === picked ? 'picked' : ''}`} onClick={() => setPicked(i)}>
            <div className="j-top">
              <span className="j-time">{fmtMin(j.totalS)}</span>
              <span className="j-tags">
                {i === 0 && <span className="j-tag">Ən rahat</span>}
                {fastest != null && j.totalS === fastest && i !== 0 && <span className="j-tag alt">Ən sürətli</span>}
              </span>
            </div>
            <div className="j-legs">
              {j.legs.map((l, k) => (
                <span key={k} className="j-leg">
                  {k > 0 && <span className="j-sep" aria-hidden>›</span>}
                  <RouteBadge id={l.routeId} color={l.color} size="sm" />
                </span>
              ))}
              <span className="j-felt">
                {j.comfort === 'ayaq üstə' ? 'Ayaq üstə' : j.comfort === 'orta' ? 'Orta sıxlıq' : 'Yer var'} · hiss olunur {fmtMin(j.perceivedS)}
              </span>
            </div>
            <ul className="j-steps">
              {j.legs.map((l, k) => (
                <li key={k}>
                  {l.fromName} → {l.toName}
                  <span className="muted">
                    {' '}
                    · gözləmə {fmtMin(l.waitS)}
                    {l.level ? ` · ${LEVEL_TEXT[l.level].label.toLowerCase()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {res && <p className="source">Dolu avtobusda ayaq üstə 10 dəqiqə təxminən 23 dəqiqə kimi hiss olunur (Wardman & Whelan, 2011).</p>}
    </div>
  );
}
