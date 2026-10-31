// Operator modulu (AYNA Vahid Dispetçer Xidməti üçün analitika engine paneli).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Bell, BellOff, FileCode2, FlaskConical, History, LayoutDashboard, Smartphone } from 'lucide-react';
import { api, useLive, useNetwork, type Network, type Overview } from '../api';
import { MapView, type MapLine } from '../components/MapView';
import { fmtClock } from '../lib/format';
import { AlertCard } from './AlertCard';
import { RouteTable } from './RouteTable';
import { RouteDetail } from './RouteDetail';
import { TimeMachine } from './TimeMachine';
import { DemoPanel } from './DemoPanel';

export const LEVEL_COLOR: Record<string, string> = { '1': '#44a282', '2': '#d9a441', '3': '#e5566f', none: '#4a4a4f' };

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* səs mümkün deyil */
  }
}

export function useOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .get<Overview>('/api/operator/overview')
      .then((d) => {
        setOv(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [load]);
  return { ov, error, reload: load };
}

export function SpeedControl({ speed, onChange }: { speed: number; onChange: () => void }) {
  return (
    <div className="speed" role="radiogroup" aria-label="Simulyasiya sürəti">
      {[1, 10, 30].map((f) => (
        <button key={f} type="button" role="radio" aria-checked={speed === f} className={speed === f ? 'on' : ''} onClick={() => api.post('/api/sim/speed', { factor: f }).then(onChange)}>
          ×{f}
        </button>
      ))}
    </div>
  );
}

function Dashboard({ net }: { net: Network }) {
  const { ov, error, reload } = useOverview();
  const [sound, setSound] = useState(() => localStorage.getItem('stb.sound') !== 'off');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [sel, setSel] = useState<string | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const { state: live } = useLive((m) => {
    if (m.type === 'alert') {
      if (soundRef.current && (m.data.type === 'reserve' || m.data.type === 'bot')) beep();
      reload();
    }
    if (m.type === 'alert.update' || m.type === 'dispatch') reload();
  });

  const routes = ov?.routes ?? [];
  const buses = live?.buses ?? ov?.buses ?? [];
  const alerts = (ov?.alerts ?? []).filter((a) => (filter === 'open' ? a.status !== 'resolved' : true));
  const openCount = (ov?.alerts ?? []).filter((a) => a.status !== 'resolved').length;
  const top = (ov?.alerts ?? []).find((a) => a.type === 'reserve' && a.status === 'new') ?? (ov?.alerts ?? []).find((a) => a.status === 'new');
  const hottest = [...routes].sort((a, b) => (b.crowd.score ?? 0) - (a.crowd.score ?? 0))[0];
  const now = ov?.now ?? Date.now();

  const lines: MapLine[] = useMemo(
    () =>
      net.routes.map((r) => {
        const v = routes.find((x) => x.id === r.id);
        const lvl = v?.crowd.level ?? 'none';
        return { id: r.id, coords: r.forward, color: LEVEL_COLOR[String(lvl)], weight: sel === r.id ? 7 : lvl === 3 ? 5 : 3.5, opacity: sel && sel !== r.id ? 0.35 : 0.95, label: `${r.id} · ${r.name}` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [net, ov, sel],
  );
  const mapBuses = buses.map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, label: '', level: b.crowd.level, ring: b.bunchedFollower, reserve: b.reserve, dim: !!sel && sel !== b.routeId }));
  const selRoute = routes.find((r) => r.id === sel);

  return (
    <div className="dash">
      <header className="title-row">
        <div>
          <h1>Dispetçer paneli</h1>
          <p className="finding">
            {error
              ? error
              : top
                ? top.title
                : hottest?.crowd.level === 3
                  ? `${hottest.id} xəttində sıxlıq yüksəkdir (${Math.floor(hottest.highForMs / 60_000)} dəq). Qayda 10 dəqiqədə tövsiyə yaradacaq.`
                  : 'Bütün xətlərdə vəziyyət normaldır.'}
          </p>
        </div>
        <div className="title-tools">
          <span className="clock" title="Simulyasiya saatı (Bakı vaxtı)">
            {fmtClock(now)}
          </span>
          {ov && <SpeedControl speed={ov.speed} onChange={reload} />}
          <span className="pool">
            Ehtiyat parkda <strong>{ov?.reservePool ?? '—'}</strong> avtobus
          </span>
          <button
            type="button"
            className="btn-icon"
            aria-pressed={sound}
            onClick={() => {
              setSound(!sound);
              localStorage.setItem('stb.sound', sound ? 'off' : 'on');
            }}
            title={sound ? 'Səs bildirişi açıqdır' : 'Səs bildirişi bağlıdır'}
          >
            {sound ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
            <span className="sr-only">Səs bildirişi</span>
          </button>
        </div>
      </header>

      <div className="dash-grid">
        <section className="panel queue" aria-labelledby="q-title">
          <header className="panel-head">
            <h2 id="q-title">Xəbərdarlıqlar</h2>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={filter === 'open'} className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>
                Açıq {openCount}
              </button>
              <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                Hamısı
              </button>
            </div>
          </header>
          <div className="queue-list" aria-live="polite">
            {alerts.length ? alerts.slice(0, 30).map((a) => <AlertCard key={a.id} a={a} net={net} now={now} onChanged={reload} />) : <p className="empty">Açıq xəbərdarlıq yoxdur. Xətt 10 dəqiqə fasiləsiz “yüksək” qalanda burada avtomatik tövsiyə görünəcək.</p>}
          </div>
        </section>

        <section className="panel mapp" aria-labelledby="m-title">
          <header className="panel-head">
            <h2 id="m-title">Sıxlıq xəritəsi</h2>
            <ul className="legend" aria-label="Xəritə izahı">
              <li>
                <i style={{ background: LEVEL_COLOR['1'] }} /> aşağı
              </li>
              <li>
                <i style={{ background: LEVEL_COLOR['2'] }} /> orta
              </li>
              <li>
                <i style={{ background: LEVEL_COLOR['3'] }} /> yüksək
              </li>
              <li>
                <i style={{ background: LEVEL_COLOR.none }} /> bildiriş yoxdur
              </li>
              <li>
                <i className="ring-swatch" /> toplanmanın arxası
              </li>
            </ul>
          </header>
          <MapView theme="dark" lines={lines} buses={mapBuses} stops={[]} fitKey="all" label="Bakı: xətlər sıxlığa görə rənglənib, nöqtələr avtobuslardır" />
        </section>
      </div>

      <section className="panel" aria-labelledby="t-title">
        <header className="panel-head">
          <h2 id="t-title">Xətlər</h2>
          <span className="fine">Sıra: sıxlıq balına görə. Sətrə klikləyin: təfərrüat, sıxlıq dalğası, proqnoz.</span>
        </header>
        {ov ? <RouteTable routes={routes} selected={sel} onSelect={setSel} /> : <div className="sk-table" aria-hidden />}
      </section>

      {selRoute && <RouteDetail r={selRoute} buses={buses.filter((b) => b.routeId === selRoute.id)} net={net} now={now} onClose={() => setSel(null)} onDispatched={reload} />}
    </div>
  );
}

export function OperatorApp() {
  const { net, error } = useNetwork();
  return (
    <div className="operator">
      <a href="#op-main" className="skip">
        Əsas məzmuna keç
      </a>
      <nav className="rail" aria-label="Dispetçer bölmələri">
        <span className="rail-mark" aria-label="Bakı Sıxlıq · AYNA dispetçer">
          <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden>
            <rect x="14" y="36" width="9" height="14" rx="2" fill="#fff" />
            <rect x="27.5" y="26" width="9" height="24" rx="2" fill="#fff" />
            <rect x="41" y="14" width="9" height="36" rx="2" fill="#4a8ad6" />
          </svg>
        </span>
        <NavLink end to="/operator" title="Ümumi baxış">
          <LayoutDashboard size={18} aria-hidden />
          <span className="rail-label">Panel</span>
        </NavLink>
        <NavLink to="/operator/history" title="Vaxt maşını">
          <History size={18} aria-hidden />
          <span className="rail-label">Tarixçə</span>
        </NavLink>
        <NavLink to="/operator/demo" title="Simulyasiya və demo">
          <FlaskConical size={18} aria-hidden />
          <span className="rail-label">Demo</span>
        </NavLink>
        <span className="rail-gap" />
        <a href="/" title="Sərnişin tətbiqi">
          <Smartphone size={18} aria-hidden />
          <span className="rail-label">Sərnişin</span>
        </a>
        <a href="/api/docs" title="API sənədi" target="_blank" rel="noreferrer">
          <FileCode2 size={18} aria-hidden />
          <span className="rail-label">API</span>
        </a>
      </nav>
      <main id="op-main" className="op-main" tabIndex={-1}>
        {error && <p className="report-err">{error}</p>}
        {net && (
          <Routes>
            <Route index element={<Dashboard net={net} />} />
            <Route path="history" element={<TimeMachine net={net} />} />
            <Route path="demo" element={<DemoPanel />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
