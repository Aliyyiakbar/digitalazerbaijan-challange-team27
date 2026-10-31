// Xəbərdarlıq kartı: başlıq, tövsiyə, "Niyə?" izahı (sübutlar), əməliyyatlar.
import { useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { api, type Alert, type Network } from '../api';
import { RouteBadge, TrustMark } from '../components/Crowd';
import { ALERT_TYPE_TEXT, CAUSE_TEXT, fmtScore, pct, since } from '../lib/format';

type Ex = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : null);

function Evidence({ a }: { a: Alert }) {
  const e = a.explanation as Ex;
  const rows: Array<[string, string]> = [];
  if (a.type === 'reserve') {
    rows.push(['Qayda', String(e.rule ?? '')]);
    rows.push(['Fasiləsiz yüksək', `${e.highForMin} dəq`]);
    rows.push(['Bal', `${fmtScore(num(e.score))} (hədd 2.4)`]);
    rows.push(['Bildirişlər', `${e.reports} bildiriş, ${e.devices} cihaz`]);
    rows.push(['Etibar', pct(num(e.confidence))]);
    rows.push(['Səbəb', `${CAUSE_TEXT[String(e.cause)] ?? e.cause}. ${e.causeText}`]);
    if (num(e.speedRatio) != null) rows.push(['Sürət / norma', pct(num(e.speedRatio))]);
    if (num(e.dwellRatio) != null) rows.push(['Dayanma / şəbəkə medianı', `×${num(e.dwellRatio)!.toFixed(2)}`]);
    if (num(e.forecast30) != null) rows.push(['30 dəq sonra proqnoz', fmtScore(num(e.forecast30))]);
    const donor = e.donor as { routeId: string; score: number; buses: number } | null;
    if (donor) rows.push(['Az yüklü xətt', `${donor.routeId}: bal ${donor.score.toFixed(1)}, ${donor.buses} avtobus`]);
    const ds = e.dispatchStop as { name: string } | undefined;
    if (ds) rows.push(['Buraxılış nöqtəsi', ds.name]);
  } else if (a.type === 'bot') {
    rows.push(['Karantinə alındı', `${e.quarantined} bildiriş`]);
    rows.push(['Son dəqiqədə', `${e.ratePerMin} bildiriş (adi ~${num(e.baselinePerMin)?.toFixed(1)})`]);
  } else if (a.type === 'bunching') {
    rows.push(['İdeal interval', `${e.idealHeadwayMin} dəq`]);
    rows.push(['İntervalların dağınıqlığı (CV)', String(e.cv)]);
    rows.push(['Üsul', String(e.method)]);
  } else if (a.type === 'forecast') {
    rows.push(['15 dəq sonra', fmtScore(num(e.p15))]);
    rows.push(['30 dəq sonra', fmtScore(num(e.p30))]);
    rows.push(['İndi', fmtScore(num(e.now))]);
    rows.push(['Model', String(e.model)]);
    if (num(e.mae) != null) rows.push(['Modelin orta xətası', `±${num(e.mae)!.toFixed(2)} bal`]);
  } else if (a.type === 'traffic') {
    rows.push(['Sürət / norma', pct(num(e.speedRatio))]);
    rows.push(['GTFS-RT', String(e.congestion)]);
    rows.push(['İzah', String(e.text)]);
  }
  const reasons = (e.reasons as string[] | undefined) ?? (e.signals as string[] | undefined) ?? [];
  return (
    <div className="evidence">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AlertCard({ a, net, now, onChanged, style }: { a: Alert; net: Network; now: number; onChanged: () => void; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const route = net.routes.find((r) => r.id === a.routeId);
  const donor = (a.explanation as Ex).donor as { routeId: string } | null | undefined;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg(typeof r === 'object' && r && 'atStop' in r ? `${ok}: ${(r as { atStop: string }).atStop} dayanacağından` : ok);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Alınmadı');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`alert a-${a.type} st-${a.status}`} aria-labelledby={`al-${a.id}`} style={style}>
      <header>
        <span className="a-type">{ALERT_TYPE_TEXT[a.type]}</span>
        {route && <RouteBadge id={route.id} color={route.color} size="sm" />}
        <span className="a-time">{since(a.createdAt, now)}</span>
        {a.type === 'reserve' || a.type === 'bot' ? <TrustMark badge={a.badge} confidence={a.confidence ?? undefined} /> : null}
        {a.status !== 'new' && <span className="a-status">{a.status === 'ack' ? 'Qəbul edilib' : 'Həll olunub'}</span>}
      </header>
      <h3 id={`al-${a.id}`}>{a.title}</h3>
      <p className="a-rec">{a.recommendation}</p>
      {a.dispatchedBusId && <p className="a-done">Göndərildi: {a.dispatchedBusId}</p>}
      <button type="button" className="why" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} aria-hidden className={open ? 'rot' : ''} /> Niyə?
      </button>
      {open && <Evidence a={a} />}
      {a.status !== 'resolved' && (
        <div className="a-actions">
          {a.type === 'reserve' && !a.dispatchedBusId && (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => api.post('/api/operator/dispatch', { routeId: a.routeId, source: 'reserve', alertId: a.id }), 'Ehtiyat avtobus xəttə buraxıldı')}>
                Ehtiyat avtobus göndər
              </button>
              {donor && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.post('/api/operator/dispatch', { routeId: a.routeId, source: 'transfer', fromRouteId: donor.routeId, alertId: a.id }), `${donor.routeId} xəttindən köçürüldü`)}>
                  {donor.routeId} xəttindən köçür
                </button>
              )}
            </>
          )}
          {a.status === 'new' && a.type !== 'reserve' && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.patch(`/api/operator/alerts/${a.id}`, { status: 'ack' }))}>
              Qəbul et
            </button>
          )}
          <button type="button" className="btn-text" disabled={busy} onClick={() => run(() => api.patch(`/api/operator/alerts/${a.id}`, { status: 'resolved' }))}>
            Həll olundu
          </button>
        </div>
      )}
      {msg && (
        <p className="a-msg" role="status">
          {msg}
        </p>
      )}
    </article>
  );
}
