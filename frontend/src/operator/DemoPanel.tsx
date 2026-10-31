// Demo paneli: ssenarilər münsiflərə canlı göstərmək üçündür və açıq şəkildə "simulyasiya" adlanır.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtClock } from '../lib/format';
import { SpeedControl } from './OperatorApp';

interface SimState {
  now: number;
  speed: number;
  mode: string;
  sim: { scenarios: Array<{ name: string; routeId: string; until: number; target: string | null }>; buses: number; waiting: number } | null;
}

const SCENARIOS: Array<{ name: string; route: string; title: string; shows: string }> = [
  { name: 'peak', route: 'M6', title: 'Pik saat: M6 həddən artıq dolur', shows: 'Əsas qayda. Tələbat 3 dəfə artır, xətt 10 dəqiqə “yüksək” qalanda avtomatik “əlavə ehtiyat avtobus” tövsiyəsi yaranır. ×30 sürətdə təxminən 30 saniyə.' },
  { name: 'fake', route: 'M1', title: 'Boş avtobusa “çox sıx” deyirlər', shows: 'Kənar hal. Toplanmış cütün arxasındakı boş avtobusa 6 cihaz “yüksək” göndərir, 4-ü evdən. Etibar düşür, nişan “yoxlanılmalı/şübhəli” olur, sərnişinə təsdiq sualı çıxır.' },
  { name: 'bots', route: 'M3', title: 'Bot hücumu', shows: 'Saniyədə bir bildiriş, 2 IP, koordinatsız, yeni cihazlar. Sistem hücumu tanıyır, bildirişləri karantinə alır və xəbərdarlıq verir.' },
  { name: 'traffic', route: '6', title: 'Tıxac: 6 nömrəli xətt', shows: 'Sürət 30%-ə düşür, dayanma adi qalır. Səbəb “tıxac” kimi təsnif olunur və əlavə avtobusun kömək etməyəcəyi deyilir.' },
  { name: 'bunch', route: 'M2', title: 'Avtobuslar toplanır', shows: 'İki avtobus bir-birinin ardınca düşür. Panel arxadakını neçə dəqiqə saxlamağı tövsiyə edir; sərnişinə “növbətini gözlə” deyilir.' },
];

export function DemoPanel() {
  const [st, setSt] = useState<SimState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get<SimState>('/api/sim/state').then(setSt).catch(() => {});
  useEffect(() => {
    load();
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, []);
  const run = (name: string, routeId?: string) =>
    api
      .post<{ message: string }>('/api/sim/scenario', { name, routeId })
      .then((r) => {
        setMsg(r.message);
        load();
      })
      .catch((e: Error) => setMsg(e.message));

  return (
    <div className="dash demo">
      <header className="title-row">
        <div>
          <h1>Simulyasiya və demo</h1>
          <p className="finding">AYNA-nın açıq GPS axını olmadığı üçün avtobus parkı simulyasiya olunur. Aşağıdakı ssenarilər yalnız demo üçündür.</p>
        </div>
        <div className="title-tools">
          {st && <span className="clock">{fmtClock(st.now)}</span>}
          {st && <SpeedControl speed={st.speed} onChange={load} />}
        </div>
      </header>
      {msg && (
        <p className="a-msg" role="status">
          {msg}
        </p>
      )}
      <section className="panel">
        <header className="panel-head">
          <h2>Ssenarilər</h2>
          <button type="button" className="btn-text" onClick={() => run('reset')}>
            Hamısını dayandır
          </button>
        </header>
        <ul className="scen">
          {SCENARIOS.map((s) => {
            const active = st?.sim?.scenarios.find((x) => x.name === s.name);
            return (
              <li key={s.name}>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.shows}</p>
                  {active && (
                    <p className="fine">
                      Aktivdir: {active.routeId}
                      {active.target ? `, hədəf ${active.target}` : ''} · {fmtClock(active.until)}-dək
                    </p>
                  )}
                </div>
                <button type="button" className={active ? 'btn-secondary' : 'btn-primary'} onClick={() => run(s.name, s.route)}>
                  {active ? 'Yenidən başlat' : 'Başlat'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel">
        <header className="panel-head">
          <h2>Açıq məlumat (GTFS)</h2>
        </header>
        <ul className="links">
          <li>
            <a href="/gtfs-rt/vehicle-positions?format=json" target="_blank" rel="noreferrer">
              GTFS-RT VehiclePositions
            </a>{' '}
            : occupancy_status və congestion_level ilə. Protobuf üçün ?format parametrini silin.
          </li>
          <li>
            <a href="/gtfs-rt/trip-updates?format=json" target="_blank" rel="noreferrer">
              GTFS-RT TripUpdates
            </a>{' '}
            : dayanacaqlar üzrə ETA
          </li>
          <li>
            <a href="/gtfs-rt/alerts?format=json" target="_blank" rel="noreferrer">
              GTFS-RT Alerts
            </a>
          </li>
          <li>
            <a href="/gtfs/static.zip">Statik GTFS (zip)</a>
          </li>
          <li>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API sənədi (Swagger)
            </a>
          </li>
        </ul>
        {st?.sim && (
          <p className="fine">
            Simulyatorda {st.sim.buses} avtobus, dayanacaqlarda ~{st.sim.waiting} sərnişin gözləyir. Rejim: {st.mode}.
          </p>
        )}
      </section>
    </div>
  );
}
