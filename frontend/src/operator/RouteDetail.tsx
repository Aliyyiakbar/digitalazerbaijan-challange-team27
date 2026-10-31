// Xəttin təfərrüatı: niyə bu qiymət, səbəb, toplanma, "domino" zolağı, proqnoz, avtobuslar.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, type BusView, type Network, type RouteView } from '../api';
import { CrowdPill, RouteBadge, TrustMark } from '../components/Crowd';
import { ForecastChart, type FPoint } from '../components/ForecastChart';
import { CAUSE_TEXT, fmtMin, fmtScore, pct } from '../lib/format';

export function RouteDetail({ r, buses, net, now, onClose, onDispatched }: { r: RouteView; buses: BusView[]; net: Network; now: number; onClose: () => void; onDispatched: () => void }) {
  const [fc, setFc] = useState<{ points: FPoint[]; now: number; mae: number | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ points: FPoint[]; now: number; mae: number | null }>(`/api/operator/forecast/${r.id}`).then(setFc).catch(() => setFc(null));
  }, [r.id, Math.floor(now / 60_000)]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const route = net.routes.find((x) => x.id === r.id)!;
  const label = (id: string) => buses.find((b) => b.id === id)?.label ?? id;
  const ripple = r.ripple ?? [];

  return (
    <aside className="drawer" aria-labelledby="rd-title">
      <header className="drawer-head">
        <h2 id="rd-title">
          <RouteBadge id={r.id} color={r.color} /> {r.name}
        </h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Bağla">
          <X size={18} aria-hidden />
        </button>
      </header>

      <section>
        <div className="kv-row">
          <div>
            <span className="k">Sıxlıq</span>
            <CrowdPill level={r.crowd.level} />
          </div>
          <div>
            <span className="k">Bal</span>
            <span className="v">{fmtScore(r.crowd.score)}</span>
          </div>
          <div>
            <span className="k">Etibar</span>
            <TrustMark badge={r.crowd.badge} confidence={r.crowd.confidence} />
          </div>
          <div>
            <span className="k">Fasiləsiz yüksək</span>
            <span className="v">{r.highForMs >= 60_000 ? `${Math.floor(r.highForMs / 60_000)} dəq` : '—'}</span>
          </div>
        </div>
        <h3>Niyə bu qiymət?</h3>
        <ul className="reasons">
          {r.crowd.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            api
              .post<{ atStop: string }>('/api/operator/dispatch', { routeId: r.id, source: 'reserve' })
              .then((x) => {
                setMsg(`Ehtiyat avtobus ${x.atStop} dayanacağından buraxıldı`);
                onDispatched();
              })
              .catch((e: Error) => setMsg(e.message))
          }
        >
          Ehtiyat avtobus göndər
        </button>
        {msg && (
          <p className="a-msg" role="status">
            {msg}
          </p>
        )}
      </section>

      <section>
        <h3>Tıxac, yoxsa tələbat?</h3>
        <p className="lead">
          <strong>{CAUSE_TEXT[r.cause.cause]}.</strong> {r.cause.text}.
        </p>
        <dl className="dl-inline">
          <div>
            <dt>Sürət / sərbəst axın</dt>
            <dd>{pct(r.cause.speedRatio)}</dd>
          </div>
          <div>
            <dt>Dayanma / şəbəkə medianı</dt>
            <dd>{r.cause.dwellRatio == null ? '—' : `×${r.cause.dwellRatio.toFixed(2)}`}</dd>
          </div>
          <div>
            <dt>GTFS-RT congestion_level</dt>
            <dd>{r.cause.congestion}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>İntervallar və toplanma</h3>
        <p className="lead">
          İdeal interval {fmtMin(r.headway.idealS)}, dağınıqlıq (CV) {r.headway.cv.toFixed(2)}
          {r.headway.cv > 0.5 ? ', intervallar çox qeyri-bərabərdir' : ''}.
        </p>
        {r.headway.pairs.length ? (
          <ul className="pairs">
            {r.headway.pairs.map((p) => (
              <li key={p.follower}>
                <strong>{label(p.follower)}</strong> {label(p.leader)} avtobusunun {Math.round(p.gapS)} san arxasındadır. Tövsiyə: {label(p.follower)} avtobusunu ~{fmtMin(p.holdS)} saxlayın.
              </li>
            ))}
          </ul>
        ) : (
          <p className="fine">Toplanmış avtobus cütü yoxdur.</p>
        )}
      </section>

      <section>
        <h3>Sıxlıq dalğası: harada adam minə bilməyəcək?</h3>
        <p className="fine">Hər dayanacaq üçün növbəti 5, 10 və 15 dəqiqədə yer olan avtobus gəlməmə riski. Dolu avtobus dayanacağı “ötür”, adamlar növbətini gözləyir.</p>
        <table className="ripple">
          <thead>
            <tr>
              <th scope="col">Dayanacaq</th>
              <th scope="col" className="num">
                +5
              </th>
              <th scope="col" className="num">
                +10
              </th>
              <th scope="col" className="num">
                +15
              </th>
            </tr>
          </thead>
          <tbody>
            {ripple.map((s) => (
              <tr key={s.seq}>
                <th scope="row">
                  {s.name}
                  <span className="sub"> {s.dir === 0 ? '→' : '←'}</span>
                </th>
                {s.risk.map((v, i) => (
                  <td key={i} className="num risk" style={{ ['--risk' as string]: v.toFixed(2) }}>
                    {Math.round(v * 100)}%
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Proqnoz</h3>
        {fc ? (
          <>
            <ForecastChart points={fc.points} now={fc.now} observed={r.crowd.score} />
            <p className="fine">
              Baza: xətt × 15 dəqiqə × gün növü üzrə tarixi orta (14 günlük sintetik tarixçə) + son müşahidələrin EWMA düzəlişi.
              {fc.mae != null && ` Son gündə orta xəta ±${fc.mae.toFixed(2)} bal.`}
            </p>
          </>
        ) : (
          <p className="fine">Proqnoz yüklənir…</p>
        )}
      </section>

      <section>
        <h3>Avtobuslar ({buses.length})</h3>
        <ul className="bus-list">
          {buses.map((b) => (
            <li key={b.id}>
              <span className="bl-label">{b.label}</span>
              <span className="bl-to">
                → {b.towards} · {b.speedKmh} km/s{b.bunchedFollower ? ' · toplanmanın arxası' : ''}
                {b.reserve ? ' · ehtiyat' : ''}
              </span>
              <CrowdPill level={b.crowd.level} compact />
              <TrustMark badge={b.crowd.badge} confidence={b.crowd.confidence} showText={false} />
            </li>
          ))}
        </ul>
        <p className="fine">Dayanacaqlar: {route.stopIds.map((id) => net.stops.find((s) => s.id === id)?.name).join(' · ')}</p>
      </section>
    </aside>
  );
}
