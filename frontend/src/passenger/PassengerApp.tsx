// Sərnişin modulu (PWA). Telefon üçün əvvəlcə: alt naviqasiya, böyük toxunma hədəfləri,
// sadə rejim, yüksək kontrast, böyük şrift; masaüstündə panel + xəritə.
import { useEffect, useMemo, useState } from 'react';
import { Accessibility, BusFront, Clock, Download, Route as RouteIcon, WifiOff } from 'lucide-react';
import { flushQueue, queuedCount, useLive, useNetwork, useOnline } from '../api';
import { MapView, type MapBus, type MapLine, type MapStop } from '../components/MapView';
import { ArrivalsView } from './ArrivalsView';
import { PlannerView } from './PlannerView';
import { LinesView } from './LinesView';

type Tab = 'arrivals' | 'plan' | 'lines';
interface Prefs {
  simple: boolean;
  contrast: boolean;
  large: boolean;
}

function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, setP] = useState<Prefs>(() => ({ simple: false, contrast: false, large: false, ...JSON.parse(localStorage.getItem('stb.prefs') ?? '{}') }));
  return [
    p,
    (patch) => {
      const n = { ...p, ...patch };
      setP(n);
      localStorage.setItem('stb.prefs', JSON.stringify(n));
    },
  ];
}

type InstallEvent = Event & { prompt: () => Promise<void> };

export function PassengerApp() {
  const { net, error } = useNetwork();
  const { state: live, connected } = useLive();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('arrivals');
  const [stopId, setStopId] = useState(() => localStorage.getItem('stb.stop') ?? 'GEN');
  const [routeId, setRouteId] = useState(() => localStorage.getItem('stb.route') ?? 'M6');
  const [prefs, setPrefs] = usePrefs();
  const [menu, setMenu] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [queued, setQueued] = useState(queuedCount());

  useEffect(() => localStorage.setItem('stb.stop', stopId), [stopId]);
  useEffect(() => localStorage.setItem('stb.route', routeId), [routeId]);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  useEffect(() => {
    if (online) flushQueue().then(() => setQueued(queuedCount()));
    const t = window.setInterval(() => setQueued(queuedCount()), 3000);
    return () => window.clearInterval(t);
  }, [online]);

  const mapData = useMemo(() => {
    if (!net) return { lines: [] as MapLine[], buses: [] as MapBus[], stops: [] as MapStop[], key: 'none' };
    if (tab === 'lines') {
      const r = net.routes.find((x) => x.id === routeId)!;
      const stopSet = new Set(r.stopIds);
      return {
        lines: [{ id: r.id, coords: [...r.forward, ...r.backward], color: '#0a0a0a', weight: 4, opacity: 0.85 }],
        buses: (live?.buses ?? []).filter((b) => b.routeId === routeId).map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, label: b.label, level: b.crowd.level, ring: b.bunchedFollower, reserve: b.reserve })),
        stops: net.stops.filter((s) => stopSet.has(s.id)).map((s) => ({ ...s, selected: false })),
        key: `line-${routeId}`,
      };
    }
    const stop = net.stops.find((s) => s.id === stopId)!;
    const routes = net.routes.filter((r) => stop.routes.includes(r.id));
    const rs = new Set(stop.routes);
    return {
      lines: routes.map((r) => ({ id: r.id, coords: r.forward, color: '#8a8a8a', weight: 3, opacity: 0.7, label: `${r.id} · ${r.name}` })),
      buses: (live?.buses ?? []).filter((b) => rs.has(b.routeId)).map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, label: b.label, level: b.crowd.level, ring: b.bunchedFollower, reserve: b.reserve })),
      stops: net.stops.filter((s) => s.routes.some((r) => rs.has(r))).map((s) => ({ ...s, selected: s.id === stopId })),
      key: `stop-${stopId}`,
    };
  }, [net, live, tab, stopId, routeId]);

  const cls = ['passenger', prefs.simple && 'simple', prefs.contrast && 'contrast', prefs.large && 'large'].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <a href="#main" className="skip">
        Əsas məzmuna keç
      </a>
      <header className="p-top">
        <a className="wordmark" href="/" aria-label="Bakı Sıxlıq, ana səhifə">
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
            <rect width="64" height="64" rx="14" fill="currentColor" />
            <rect x="14" y="36" width="9" height="14" rx="2" fill="var(--surface)" />
            <rect x="27.5" y="26" width="9" height="24" rx="2" fill="var(--surface)" />
            <rect x="41" y="14" width="9" height="36" rx="2" fill="var(--chart-3)" />
          </svg>
          <span>Bakı Sıxlıq</span>
        </a>
        <span className={`conn ${connected ? 'ok' : 'off'}`} role="status">
          {connected ? 'Canlı' : 'Qoşulur…'}
        </span>
        <div className="menu-wrap">
          <button type="button" className="btn-icon" aria-expanded={menu} aria-controls="a11y-menu" onClick={() => setMenu(!menu)}>
            <Accessibility size={18} aria-hidden />
            <span className="sr-only">Görünüş parametrləri</span>
          </button>
          {menu && (
            <div id="a11y-menu" className="menu" role="group" aria-label="Görünüş parametrləri">
              <label>
                <input type="checkbox" checked={prefs.simple} onChange={(e) => setPrefs({ simple: e.target.checked })} /> Sadə rejim (xəritəsiz, yalnız növbəti 3 avtobus)
              </label>
              <label>
                <input type="checkbox" checked={prefs.large} onChange={(e) => setPrefs({ large: e.target.checked })} /> Böyük şrift
              </label>
              <label>
                <input type="checkbox" checked={prefs.contrast} onChange={(e) => setPrefs({ contrast: e.target.checked })} /> Yüksək kontrast
              </label>
              {install && (
                <button
                  type="button"
                  className="btn-dark"
                  onClick={async () => {
                    await install.prompt();
                    setInstall(null);
                  }}
                >
                  <Download size={16} aria-hidden /> Telefona quraşdır
                </button>
              )}
              <a className="btn-link" href="/operator">
                Dispetçer paneli
              </a>
            </div>
          )}
        </div>
      </header>

      {(!online || queued > 0) && (
        <p className="offline" role="status">
          <WifiOff size={16} aria-hidden /> {online ? `${queued} bildiriş göndərilməyi gözləyir` : 'İnternet yoxdur. Son məlumat göstərilir; bildirişlər yadda saxlanılır.'}
        </p>
      )}

      <div className="p-body">
        <main id="main" className="p-panel" tabIndex={-1}>
          {error && (
            <p className="report-err" role="alert">
              {error}
            </p>
          )}
          {!net && !error && <p className="fine">Yüklənir…</p>}
          {net && tab === 'arrivals' && <ArrivalsView net={net} stopId={stopId} onStop={setStopId} simple={prefs.simple} />}
          {net && tab === 'plan' && <PlannerView net={net} from={stopId} setFrom={setStopId} />}
          {net && tab === 'lines' && <LinesView net={net} live={live} routeId={routeId} setRouteId={setRouteId} />}
        </main>
        {!prefs.simple && net && (
          <div className="p-map">
            <MapView theme="light" lines={mapData.lines} buses={mapData.buses} stops={mapData.stops} onStopClick={(id) => setStopId(id)} fitKey={mapData.key} label="Xəritə: avtobusların canlı yerləşməsi və sıxlığı" />
          </div>
        )}
      </div>

      <nav className="p-tabs" aria-label="Bölmələr">
        <button type="button" aria-current={tab === 'arrivals' ? 'page' : undefined} onClick={() => setTab('arrivals')}>
          <Clock size={20} aria-hidden />
          <span>Gəlişlər</span>
        </button>
        <button type="button" aria-current={tab === 'plan' ? 'page' : undefined} onClick={() => setTab('plan')}>
          <RouteIcon size={20} aria-hidden />
          <span>Marşrut</span>
        </button>
        <button type="button" aria-current={tab === 'lines' ? 'page' : undefined} onClick={() => setTab('lines')}>
          <BusFront size={20} aria-hidden />
          <span>Xətlər</span>
        </button>
      </nav>
    </div>
  );
}
