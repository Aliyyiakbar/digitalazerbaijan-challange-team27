// Sərnişin modulu (PWA) — AYNA MaaS kimi: tam ekran xəritə, üstdə axtarış, altda panel.
// Bir ekranda bir iş: ana səhifə → dayanacaq → avtobus; xətt; marşrut planı.
import { useEffect, useMemo, useState } from 'react';
import { Accessibility, Download, LocateFixed, Search, WifiOff } from 'lucide-react';
import { flushQueue, queuedCount, useBackground, useLive, useNetwork, useOnline } from '../api';
import { MapView, type FitRequest, type MapBus, type MapLine, type MapStop } from '../components/MapView';
import { Sheet, useIsDesktop, type Snap } from '../components/Sheet';
import { distM, useUserLocation } from '../lib/geo';
import { HomeView } from './HomeView';
import { StopView } from './StopView';
import { RouteView } from './RouteView';
import { PlannerView } from './PlannerView';
import { SearchView } from './SearchView';

type View = { kind: 'home' } | { kind: 'stop'; id: string } | { kind: 'route'; id: string } | { kind: 'plan' } | { kind: 'search' };
interface Prefs {
  simple: boolean;
  contrast: boolean;
  large: boolean;
}
type InstallEvent = Event & { prompt: () => Promise<void> };

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

export function PassengerApp() {
  const { net, error } = useNetwork();
  const bg = useBackground();
  const { state: live, connected } = useLive();
  const online = useOnline();
  const { pos, status: locStatus, start: locate } = useUserLocation();
  const desktop = useIsDesktop();
  const [prefs, setPrefs] = usePrefs();
  const [view, setView] = useState<View>(() => {
    const s = localStorage.getItem('stb.stop');
    return s ? { kind: 'stop', id: s } : { kind: 'home' };
  });
  const [history, setHistory] = useState<View[]>([]);
  const [snap, setSnap] = useState<Snap>('peek');
  const [menu, setMenu] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [queued, setQueued] = useState(queuedCount());
  const [from, setFrom] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const go = (v: View) => {
    setHistory((h) => [...h.slice(-10), view]);
    setView(v);
    if (v.kind === 'stop') localStorage.setItem('stb.stop', v.id);
    if (v.kind === 'search' || v.kind === 'plan') setSnap('full');
    else setSnap('peek');
  };
  const back = () => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setView(prev && prev.kind !== 'search' ? prev : { kind: 'home' });
    if (!prev || prev.kind === 'home') localStorage.removeItem('stb.stop');
    setSnap('peek');
  };

  useEffect(() => {
    if (net && view.kind === 'stop' && !net.stops.some((s) => s.id === view.id)) setView({ kind: 'home' });
  }, [net, view]);
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
    const t = window.setInterval(() => setQueued(queuedCount()), 4000);
    return () => window.clearInterval(t);
  }, [online]);

  // ---------------------------------------------------------------- xəritə
  const map = useMemo((): { lines: MapLine[]; buses: MapBus[]; stops: MapStop[]; fit: FitRequest | null } => {
    const empty = { lines: [] as MapLine[], buses: [] as MapBus[], stops: [] as MapStop[], fit: null as FitRequest | null };
    if (!net) return empty;
    const routeById = new Map(net.routes.map((r) => [r.id, r]));
    const coords = (id: string) => {
      const r = routeById.get(id)!;
      return [...r.forward, ...r.backward];
    };
    const busFor = (ids: Set<string> | null, labeled: boolean): MapBus[] =>
      (live?.buses ?? [])
        .filter((b) => !ids || ids.has(b.routeId))
        .map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, label: labeled ? b.routeId : '', level: b.crowd.level, color: routeById.get(b.routeId)?.color, ring: b.bunchedFollower, reserve: b.reserve }));
    const userPt: [number, number][] = pos ? [[pos.lat, pos.lon]] : [];

    if (view.kind === 'stop') {
      const stop = net.stops.find((s) => s.id === view.id);
      if (!stop) return empty;
      const ids = new Set(stop.routes);
      return {
        lines: stop.routes.map((id) => ({ id, coords: coords(id), color: routeById.get(id)!.color, weight: 4, opacity: 0.85, label: `${id} · ${routeById.get(id)!.name}`, onClick: () => go({ kind: 'route', id }) })),
        buses: busFor(ids, true),
        stops: [{ ...stop, selected: true }],
        fit: { key: `stop-${stop.id}-${fitNonce}`, points: [[stop.lat, stop.lon] as [number, number], ...(pos && distM(pos, stop) < 2500 ? userPt : [])] },
      };
    }
    if (view.kind === 'route') {
      const r = routeById.get(view.id);
      if (!r) return empty;
      const sids = new Set(r.stopIds);
      return {
        lines: [{ id: r.id, coords: coords(r.id), color: r.color, weight: 5, opacity: 0.95 }],
        buses: busFor(new Set([r.id]), true),
        stops: net.stops.filter((s) => sids.has(s.id)),
        fit: { key: `route-${r.id}-${fitNonce}`, points: coords(r.id) },
      };
    }
    // ana səhifə: bütün canlı xətlər öz rəngində, yaxındakı dayanacaqlar
    const near = pos ? [...net.stops].sort((a, b) => distM(pos, a) - distM(pos, b)).slice(0, 6) : [];
    return {
      lines: net.routes.map((r) => ({ id: r.id, coords: coords(r.id), color: r.color, weight: 2.5, opacity: 0.6, label: `${r.id} · ${r.name}`, onClick: () => go({ kind: 'route', id: r.id }) })),
      buses: busFor(null, false),
      stops: near,
      fit: pos ? { key: `home-user-${fitNonce}`, points: [[pos.lat, pos.lon] as [number, number], ...near.slice(0, 3).map((s) => [s.lat, s.lon] as [number, number])] } : { key: `home-${fitNonce}`, points: [[40.36, 49.78], [40.47, 49.98]] as [number, number][] },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, live, view, pos, fitNonce]);

  const background: MapLine[] = useMemo(() => (bg?.routes ?? []).map((r) => ({ id: r.id, coords: r.coords, color: '#7b8794', weight: 1.4, opacity: 0.28 })), [bg]);

  // panel xəritənin bir hissəsini örtür — fit zamanı nəzərə al
  const pad = desktop ? { tl: [460, 40] as [number, number], br: [40, 40] as [number, number] } : { tl: [24, 90] as [number, number], br: [24, Math.round(window.innerHeight * 0.45)] as [number, number] };

  // ilk dəfə yer təyin olunanda xəritəni ora gətir
  useEffect(() => {
    if (pos && view.kind === 'home') setFitNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos != null]);

  const cls = ['passenger', prefs.simple && 'simple', prefs.contrast && 'contrast', prefs.large && 'large'].filter(Boolean).join(' ');

  const body =
    !net ? (
      <div className="view">{error ? <p className="hint err">{error}</p> : <p className="hint">Yüklənir…</p>}</div>
    ) : view.kind === 'search' ? (
      <SearchView net={net} onClose={back} onStop={(id) => go({ kind: 'stop', id })} onRoute={(id) => go({ kind: 'route', id })} />
    ) : view.kind === 'stop' ? (
      <StopView net={net} stopId={view.id} pos={pos} simple={prefs.simple} onBack={back} onRoute={(id) => go({ kind: 'route', id })} />
    ) : view.kind === 'route' ? (
      <RouteView net={net} live={live} routeId={view.id} onBack={back} onStop={(id) => go({ kind: 'stop', id })} />
    ) : view.kind === 'plan' ? (
      <PlannerView net={net} pos={pos} from={from} setFrom={setFrom} onBack={back} />
    ) : (
      <HomeView net={net} pos={pos} locStatus={locStatus} onLocate={locate} onStop={(id) => go({ kind: 'stop', id })} onRoute={(id) => go({ kind: 'route', id })} onPlan={() => go({ kind: 'plan' })} />
    );

  const searchBar = view.kind !== 'search' && (
    <button type="button" className="search-bar" onClick={() => go({ kind: 'search' })}>
      <Search size={18} aria-hidden />
      <span>Dayanacaq və ya xətt axtar</span>
    </button>
  );

  return (
    <div className={cls}>
      <a href="#sheet" className="skip">
        Əsas məzmuna keç
      </a>
      {!prefs.simple && (
        <div className="p-map">
          <MapView
            theme="light"
            background={background}
            lines={map.lines}
            buses={map.buses}
            stops={map.stops}
            user={pos}
            fit={map.fit}
            pad={pad}
            onStopClick={(id) => go({ kind: 'stop', id })}
            label="Xəritə: xətlər, avtobuslar və sizin yeriniz"
          />
        </div>
      )}

      {/* üst sağ düymələr */}
      <div className="fab-col">
        <button
          type="button"
          className={`fab ${locStatus === 'on' ? 'on' : ''}`}
          onClick={() => {
            locate();
            setFitNonce((n) => n + 1);
            if (view.kind !== 'home' && view.kind !== 'stop') go({ kind: 'home' });
          }}
          aria-label="Yerimi göstər"
          title={locStatus === 'denied' ? 'Yer icazəsi verilməyib' : 'Yerimi göstər'}
        >
          <LocateFixed size={20} aria-hidden />
        </button>
        <div className="menu-wrap">
          <button type="button" className="fab" aria-expanded={menu} aria-controls="a11y-menu" onClick={() => setMenu(!menu)} aria-label="Görünüş parametrləri">
            <Accessibility size={20} aria-hidden />
          </button>
          {menu && (
            <div id="a11y-menu" className="menu" role="group" aria-label="Görünüş parametrləri">
              <label>
                <input type="checkbox" checked={prefs.simple} onChange={(e) => setPrefs({ simple: e.target.checked })} /> Sadə rejim: xəritəsiz, yalnız növbəti 3 avtobus
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
              <a className="menu-link" href="/operator">
                Dispetçer paneli
              </a>
              <span className={`conn ${connected ? 'ok' : ''}`}>{connected ? 'Canlı məlumat qoşulub' : 'Qoşulur…'}</span>
            </div>
          )}
        </div>
      </div>

      {(!online || queued > 0) && (
        <p className="offline" role="status">
          <WifiOff size={16} aria-hidden /> {online ? `${queued} bildiriş göndərilməyi gözləyir` : 'İnternet yoxdur. Bildirişlər yadda saxlanılır.'}
        </p>
      )}

      {!desktop && !prefs.simple && <div className="top-search">{searchBar}</div>}

      {prefs.simple ? (
        <main id="sheet" className="simple-page">
          {searchBar}
          {body}
        </main>
      ) : (
        <Sheet snap={snap} onSnap={setSnap} label="Məlumat paneli">
          <main id="sheet" tabIndex={-1}>
            {desktop && searchBar}
            {body}
          </main>
        </Sheet>
      )}
    </div>
  );
}
