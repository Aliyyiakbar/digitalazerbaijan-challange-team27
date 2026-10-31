// Kompüter versiyası. Geniş ekrandan istifadə edir: solda iş paneli, ortada xəritə, sağda şəbəkənin
// vəziyyəti; siçanla xəttin üzərinə gələndə xəritədə seçilir, klaviatura ilə işləyir ( / axtarış, Esc geri ).
// Dar pəncərədə panel aşağı keçir. Telefon üçün ayrıca tətbiq /mobile ünvanındadır.
import { useEffect, useMemo, useState } from 'react';
import { Accessibility, BusFront, Compass, Download, Layers as LayersIcon, LocateFixed, PanelRightOpen, Route as RouteIcon, Search, Star, WifiOff } from 'lucide-react';
import { MapView } from '../components/MapView';
import { Sheet, useIsDesktop, type Snap } from '../components/Sheet';
import { locationControlLabel } from '../lib/geo';
import { HomeView } from './HomeView';
import { LinesView } from './LinesView';
import { NetworkPanel } from './NetworkPanel';
import { PlannerView } from './PlannerView';
import { RouteView } from './RouteView';
import { SavedView } from './SavedView';
import { SearchView } from './SearchView';
import { StopView } from './StopView';
import { usePassenger, useScene, useResolvedTheme, type Layers, type View } from './usePassenger';

const TABS: Array<{ kind: View['kind']; label: string; icon: typeof Compass }> = [
  { kind: 'home', label: 'Kəşf et', icon: Compass },
  { kind: 'plan', label: 'Marşrut', icon: RouteIcon },
  { kind: 'lines', label: 'Xətlər', icon: BusFront },
  { kind: 'saved', label: 'Seçilmişlər', icon: Star },
];

function useWide() {
  const q = '(min-width: 1280px)';
  const [w, setW] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const h = () => setW(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return w;
}

export function PassengerApp() {
  const c = usePassenger('');
  const { net, error, live, connected, online, pos, locStatus, locate, prefs, setPrefs, saved, toggleStop, toggleRoute, install, setInstall, queued, from, setFrom, fitNonce, refit, journey, setJourney, view, go, back, dir, setDir, bg } = c;
  const desktop = useIsDesktop();
  const wide = useWide();
  const [snap, setSnap] = useState<Snap>('peek');
  const [menu, setMenu] = useState<'a11y' | 'layers' | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ buses: true, others: true, crowd: false });
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('stb.panel') !== 'off');
  const showPanel = wide && panelOpen && !prefs.simple && !!net;

  useEffect(() => {
    setHover(null);
    setSnap(view.kind === 'search' || view.kind === 'plan' || view.kind === 'lines' || view.kind === 'saved' ? 'full' : 'peek');
  }, [view]);

  // klaviatura: "/" axtarış, Esc geri və ya menyunu bağla
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (view.kind !== 'search') go({ kind: 'search' });
      } else if (e.key === 'Escape') {
        if (menu) setMenu(null);
        else if (view.kind !== 'home') back();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [view, go, back, menu]);

  const scene = useScene({ net, live, view, dir, pos, fitNonce, journey, layers, hover, bg });
  const pad = useMemo(() => (desktop ? { tl: [472, 48] as [number, number], br: [showPanel ? 372 : 48, 48] as [number, number] } : { tl: [24, 90] as [number, number], br: [24, Math.round(window.innerHeight * 0.45)] as [number, number] }), [desktop, showPanel]);

  const theme = useResolvedTheme(prefs.theme);
  const cls = ['passenger', 'desk', showPanel && 'with-panel', theme === 'dark' && 'dark', prefs.simple && 'simple', prefs.contrast && 'contrast', prefs.large && 'large'].filter(Boolean).join(' ');
  const onStop = (id: string) => go({ kind: 'stop', id });
  const onRoute = (id: string) => go({ kind: 'route', id });
  const viewKey = `${view.kind}:${'id' in view ? view.id : ''}`;

  const body = !net ? (
    <div className="view">{error ? <p className="hint err">{error}</p> : <p className="hint">Yüklənir…</p>}</div>
  ) : view.kind === 'search' ? (
    <SearchView net={net} onClose={back} onStop={onStop} onRoute={onRoute} />
  ) : view.kind === 'stop' ? (
    <StopView net={net} stopId={view.id} pos={pos} simple={prefs.simple} starred={saved.stops.includes(view.id)} onStar={() => toggleStop(view.id)} onBack={back} onRoute={onRoute} onHoverRoute={setHover} />
  ) : view.kind === 'route' ? (
    <RouteView net={net} live={live} routeId={view.id} dir={dir} setDir={setDir} starred={saved.routes.includes(view.id)} onStar={() => toggleRoute(view.id)} rich={desktop} onBack={back} onStop={onStop} />
  ) : view.kind === 'plan' ? (
    <PlannerView net={net} pos={pos} from={from} setFrom={setFrom} onBack={back} onJourney={setJourney} showHead={!desktop} />
  ) : view.kind === 'lines' ? (
    <LinesView net={net} live={live} savedRoutes={saved.routes} onRoute={onRoute} onHover={setHover} title={false} />
  ) : view.kind === 'saved' ? (
    <SavedView net={net} saved={saved} onStop={onStop} onRoute={onRoute} title={false} />
  ) : (
    <HomeView net={net} pos={pos} locStatus={locStatus} onLocate={locate} onStop={onStop} onRoute={onRoute} onPlan={() => go({ kind: 'plan' })} />
  );

  const searchBar = view.kind !== 'search' && (
    <button type="button" className="search-bar" onClick={() => go({ kind: 'search' })}>
      <Search size={18} aria-hidden />
      <span>Dayanacaq və ya xətt axtar</span>
      {desktop && <kbd aria-hidden>/</kbd>}
    </button>
  );

  const deskHead = desktop && (
    <>
      <div className="d-brand">
        <a className="wordmark" href="/" aria-label="Smart Transit Baku, ana səhifə">
          <img src="/icon.svg" width="24" height="24" alt="" aria-hidden />
          <span>Smart Transit Baku</span>
        </a>
        <span className={`conn ${connected ? 'ok' : ''}`} role="status">
          {connected ? 'Canlı' : 'Qoşulur…'}
        </span>
      </div>
      <nav className="d-tabs" aria-label="Bölmələr">
        {TABS.map((t) => (
          <button key={t.kind} type="button" aria-current={view.kind === t.kind ? 'page' : undefined} onClick={() => go({ kind: t.kind } as View)}>
            <t.icon size={16} aria-hidden />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
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
            background={scene.background}
            lines={scene.lines}
            buses={scene.buses}
            stops={scene.stops}
            arrows={scene.arrows}
            arrowColor={scene.arrowColor}
            user={pos}
            fit={scene.fit}
            pad={pad}
            zoomControl={desktop}
            onStopClick={onStop}
            label="Xəritə: xətlər, avtobuslar və sizin yeriniz"
          />
        </div>
      )}

      <div className="fab-col">
        <button
          type="button"
          className={`fab ${locStatus === 'on' ? 'on' : ''} ${locStatus === 'locating' ? 'locating' : ''}`}
          disabled={locStatus === 'locating'}
          onClick={() => {
            locate();
            refit();
            if (view.kind !== 'home' && view.kind !== 'stop') go({ kind: 'home' });
          }}
          aria-label={locationControlLabel(locStatus)}
          title={locationControlLabel(locStatus)}
        >
          <LocateFixed size={20} aria-hidden className={locStatus === 'locating' ? 'locate-spin' : undefined} />
        </button>
        {!prefs.simple && (
          <div className="menu-wrap">
            <button type="button" className={`fab ${menu === 'layers' ? 'on' : ''}`} aria-expanded={menu === 'layers'} onClick={() => setMenu(menu === 'layers' ? null : 'layers')} aria-label="Xəritə qatları" title="Xəritə qatları">
              <LayersIcon size={20} aria-hidden />
            </button>
            {menu === 'layers' && (
              <div className="menu" role="group" aria-label="Xəritə qatları">
                <label>
                  <input type="checkbox" checked={layers.buses} onChange={(e) => setLayers({ ...layers, buses: e.target.checked })} /> Avtobuslar
                </label>
                <label>
                  <input type="checkbox" checked={layers.crowd} onChange={(e) => setLayers({ ...layers, crowd: e.target.checked })} /> Sıxlığa görə rənglə
                </label>
                <label>
                  <input type="checkbox" checked={layers.others} onChange={(e) => setLayers({ ...layers, others: e.target.checked })} /> Digər AYNA marşrutları
                </label>
              </div>
            )}
          </div>
        )}
        <div className="menu-wrap">
          <button type="button" className={`fab ${menu === 'a11y' ? 'on' : ''}`} aria-expanded={menu === 'a11y'} aria-controls="a11y-menu" onClick={() => setMenu(menu === 'a11y' ? null : 'a11y')} aria-label="Görünüş parametrləri" title="Görünüş parametrləri">
            <Accessibility size={20} aria-hidden />
          </button>
          {menu === 'a11y' && (
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
              <div className="seg" role="group" aria-label="Mövzu">
                {(['auto', 'light', 'dark'] as const).map((t) => (
                  <button key={t} type="button" className={(prefs.theme ?? 'auto') === t ? 'on' : ''} onClick={() => setPrefs({ theme: t })}>
                    {t === 'auto' ? 'Avtomatik' : t === 'light' ? 'İşıqlı' : 'Qaranlıq'}
                  </button>
                ))}
              </div>
              {install && (
                <button
                  type="button"
                  className="btn-dark"
                  onClick={async () => {
                    await install.prompt();
                    setInstall(null);
                  }}
                >
                  <Download size={16} aria-hidden /> Quraşdır
                </button>
              )}
              <a className="menu-link" href="/mobile">
                Mobil versiya
              </a>
              <a className="menu-link" href="/operator">
                Dispetçer paneli
              </a>
            </div>
          )}
        </div>
        {wide && !panelOpen && !prefs.simple && (
          <button
            type="button"
            className="fab"
            aria-label="Şəbəkə panelini aç"
            title="Şəbəkə panelini aç"
            onClick={() => {
              setPanelOpen(true);
              localStorage.setItem('stb.panel', 'on');
            }}
          >
            <PanelRightOpen size={20} aria-hidden />
          </button>
        )}
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
          <div key={viewKey} className="view-enter">
            {body}
          </div>
        </main>
      ) : (
        <Sheet snap={snap} onSnap={setSnap} label="Məlumat paneli">
          <main id="sheet" tabIndex={-1}>
            {deskHead}
            {desktop && searchBar}
            <div key={viewKey} className="view-enter">
              {body}
            </div>
          </main>
        </Sheet>
      )}

      {showPanel && (
        <NetworkPanel
          net={net}
          live={live}
          connected={connected}
          onRoute={onRoute}
          onHover={setHover}
          onClose={() => {
            setPanelOpen(false);
            localStorage.setItem('stb.panel', 'off');
          }}
        />
      )}
    </div>
  );
}
