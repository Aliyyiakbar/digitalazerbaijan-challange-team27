// Vaxt maşını: son 2 saatın anlıq görüntülərini geri sarıb sıxlığın necə yayıldığına bax.
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { api, type History, type Network } from '../api';
import { MapView, type MapLine } from '../components/MapView';
import { CrowdPill, RouteBadge } from '../components/Crowd';
import { ALERT_TYPE_TEXT, CAUSE_TEXT, fmtClock, fmtScore, levelOf } from '../lib/format';
import { LEVEL_COLOR } from './OperatorApp';

export function TimeMachine({ net, theme }: { net: Network; theme: 'light' | 'dark' }) {
  const [h, setH] = useState<History | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<History>('/api/operator/history?minutes=120')
      .then((d) => {
        setH(d);
        setI(Math.max(0, d.frames.length - 1));
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!playing || !h) return;
    const t = window.setInterval(() => setI((x) => (x + 1 >= h.frames.length ? (setPlaying(false), x) : x + 1)), 250);
    return () => window.clearInterval(t);
  }, [playing, h]);

  const f = h?.frames[i];
  const lines: MapLine[] = useMemo(
    () =>
      net.routes.map((r) => {
        const s = f?.routes[r.id]?.score ?? null;
        const lvl = levelOf(s);
        return { id: r.id, coords: r.forward, color: LEVEL_COLOR[String(lvl ?? 'none')], weight: lvl === 3 ? 5 : 3.5, label: `${r.id}: bal ${fmtScore(s)}` };
      }),
    [net, f],
  );
  const t0 = h?.frames[0]?.ts ?? 0;
  const t1 = h?.frames[h.frames.length - 1]?.ts ?? 1;

  return (
    <div className="dash">
      <header className="title-row">
        <div>
          <h1>Vaxt maşını</h1>
          <p className="finding">{f ? `${fmtClock(f.ts)} vəziyyəti · ${h!.frames.length} kadr, hər biri 30 saniyə` : error ?? 'Tarixçə yüklənir…'}</p>
        </div>
        <div className="title-tools">
          <button type="button" className="btn-secondary" onClick={load}>
            <RefreshCw size={14} aria-hidden /> Yenilə
          </button>
        </div>
      </header>

      {h && h.frames.length < 2 && <p className="empty">Hələ kifayət qədər tarixçə yoxdur. Sistem hər 30 saniyədə (simulyasiya vaxtı) bir kadr saxlayır. Bir neçə dəqiqə sonra yenidən baxın.</p>}

      {h && h.frames.length >= 2 && (
        <>
          <section className="panel scrub" aria-label="Zaman zolağı">
            <button type="button" className="btn-icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Dayandır' : 'Oynat'}>
              {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            </button>
            <div className="scrub-track">
              <input type="range" min={0} max={h.frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Zaman" aria-valuetext={f ? fmtClock(f.ts) : ''} />
              <div className="scrub-marks" aria-hidden>
                {h.alerts
                  .filter((a) => a.ts >= t0 && a.ts <= t1)
                  .map((a) => (
                    <span key={a.id} className={`mark m-${a.type}`} style={{ left: `${((a.ts - t0) / (t1 - t0)) * 100}%` }} title={`${fmtClock(a.ts)} ${ALERT_TYPE_TEXT[a.type]}: ${a.title}`} />
                  ))}
              </div>
              <div className="scrub-ends">
                <span>{fmtClock(t0)}</span>
                <span>{fmtClock(t1)}</span>
              </div>
            </div>
          </section>
          <div className="dash-grid tm">
            <section className="panel mapp">
              <MapView theme={theme} lines={lines} buses={(f?.buses ?? []).map((b) => ({ id: `${b.routeId}-${b.id}`, lat: b.lat, lon: b.lon, label: '', level: b.level }))} stops={[]} fit={{ key: "tm", points: [[40.33, 49.75], [40.5, 50.05]] }} label="Seçilmiş andakı sıxlıq xəritəsi" />
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>{f ? fmtClock(f.ts) : ''} anında xətlər</h2>
              </header>
              <table className="rtable compact">
                <thead>
                  <tr>
                    <th scope="col">Xətt</th>
                    <th scope="col">Sıxlıq</th>
                    <th scope="col" className="num">
                      Bal
                    </th>
                    <th scope="col">Səbəb</th>
                    <th scope="col" className="num">
                      Avtobus
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {net.routes.map((r) => {
                    const x = f?.routes[r.id];
                    return (
                      <tr key={r.id}>
                        <th scope="row">
                          <RouteBadge id={r.id} color={r.color} size="sm" />
                        </th>
                        <td>
                          <CrowdPill level={levelOf(x?.score ?? null)} />
                        </td>
                        <td className="num">{fmtScore(x?.score ?? null)}</td>
                        <td>{x?.cause ? CAUSE_TEXT[x.cause] : '—'}</td>
                        <td className="num">{x?.buses ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <h3 className="mt">Bu dövrdəki xəbərdarlıqlar</h3>
              <ul className="tm-alerts">
                {h.alerts.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <button type="button" className="btn-link" onClick={() => setI(Math.max(0, h.frames.findIndex((fr) => fr.ts >= a.ts)))}>
                      {fmtClock(a.ts)}
                    </button>{' '}
                    {ALERT_TYPE_TEXT[a.type]} · {a.title}
                  </li>
                ))}
                {!h.alerts.length && <li className="fine">Xəbərdarlıq olmayıb.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
