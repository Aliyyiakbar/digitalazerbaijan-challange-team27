// Sıxlığı nəzərə alan marşrut planı: ən sürətli deyil, "ən az əziyyətli" variant birinci.
import { useEffect, useState } from 'react';
import { ArrowDownUp, ArrowRight } from 'lucide-react';
import { api, type Network, type PlanResult } from '../api';
import { CrowdPill, RouteBadge } from '../components/Crowd';
import { fmtMin } from '../lib/format';

export function PlannerView({ net, from, setFrom }: { net: Network; from: string; setFrom: (id: string) => void }) {
  const [to, setTo] = useState(() => localStorage.getItem('stb.to') ?? (from === 'GEN' ? 'ELM' : 'GEN'));
  const [res, setRes] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stops = [...net.stops].sort((a, b) => a.name.localeCompare(b.name, 'az'));

  useEffect(() => {
    localStorage.setItem('stb.to', to);
    if (from === to) {
      setRes(null);
      setError('Başlanğıc və son dayanacaq fərqli olmalıdır.');
      return;
    }
    let alive = true;
    const load = () =>
      api
        .get<PlanResult>(`/api/plan?from=${from}&to=${to}`)
        .then((r) => {
          if (alive) {
            setRes(r);
            setError(null);
          }
        })
        .catch((e: Error) => alive && setError(e.message));
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [from, to]);

  const fastest = res?.journeys.length ? Math.min(...res.journeys.map((j) => j.totalS)) : null;

  return (
    <section className="planner" aria-labelledby="plan-title">
      <h1 id="plan-title">Marşrut planı</h1>
      <p className="finding">Variantlar “hiss olunan vaxta” görə sıralanır: ayaq üstə dolu avtobusda 10 dəqiqə oturaraq 23 dəqiqə kimi hiss olunur.</p>
      <div className="plan-form">
        <label>
          <span>Haradan</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-icon"
          aria-label="Yerlərini dəyiş"
          onClick={() => {
            const f = from;
            setFrom(to);
            setTo(f);
          }}
        >
          <ArrowDownUp size={18} aria-hidden />
        </button>
        <label>
          <span>Haraya</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="report-err" role="alert">
          {error}
        </p>
      )}
      {res && !res.journeys.length && <p className="empty">Bu iki dayanacaq arasında ən çox bir köçürmə ilə gedən variant tapılmadı.</p>}
      <ol className="journeys">
        {res?.journeys.map((j, i) => (
          <li key={i} className="journey">
            <div className="j-head">
              <span className="j-time">{fmtMin(j.totalS)}</span>
              <span className="j-felt">hiss olunan {fmtMin(j.perceivedS)}</span>
              <span className={`j-comfort c-${j.comfort === 'yer var' ? 1 : j.comfort === 'orta' ? 2 : 3}`}>{j.comfort}</span>
              {i === 0 && <span className="j-tag">Ən rahat</span>}
              {fastest != null && j.totalS === fastest && i !== 0 && <span className="j-tag alt">Ən sürətli</span>}
            </div>
            <ul className="legs">
              {j.legs.map((l, k) => (
                <li key={k}>
                  <RouteBadge id={l.routeId} color={l.color} size="sm" />
                  <span className="leg-path">
                    {l.fromName} <ArrowRight size={14} aria-label="sonra" /> {l.toName}
                  </span>
                  <span className="leg-wait">gözləmə {fmtMin(l.waitS)}</span>
                  <CrowdPill level={l.level} compact />
                </li>
              ))}
            </ul>
            {j.transfers > 0 && <p className="fine">1 köçürmə{j.legs[1] ? `: ${j.legs[1].fromName}` : ''}</p>}
          </li>
        ))}
      </ol>
      {res && <p className="fine">Sıxlıq əmsalları: oturaraq ×{res.multipliers.medium}, ayaq üstə ×{res.multipliers.high}. Mənbə: {res.multipliers.source}.</p>}
    </section>
  );
}
