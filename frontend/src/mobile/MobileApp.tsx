// Telefon üçün ayrıca tətbiq (/mobile). Quraşdırılmış tətbiq kimi işləyir: aşağıda dörd bölmə, xəritə üzərində
// üç vəziyyətli panel, ekranın kənarından kənara rəsm, baş barmaqla çatılan idarəetmə, telefonun "geri" düyməsi.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Compass, Download, LocateFixed, Monitor, Route as RouteIcon, Search, BusFront, Star, WifiOff } from 'lucide-react';
import { BottomSheet, snapHeight, useStageHeight, type SheetSnap } from '../components/BottomSheet';
import { MapView } from '../components/MapView';
import { HomeView } from '../passenger/HomeView';
import { LinesView } from '../passenger/LinesView';
import { PlannerView } from '../passenger/PlannerView';
import { RouteView } from '../passenger/RouteView';
import { SavedView } from '../passenger/SavedView';
import { SearchView } from '../passenger/SearchView';
import { StopView } from '../passenger/StopView';
import { usePassenger, useScene, useResolvedTheme, type Layers, type View } from '../passenger/usePassenger';

const TABS: Array<{ kind: View['kind']; label: string; icon: typeof Compass; also?: View['kind'][] }> = [
  { kind: 'home', label: 'Xəritə', icon: Compass, also: ['stop', 'search'] },
  { kind: 'plan', label: 'Marşrut', icon: RouteIcon },
  { kind: 'lines', label: 'Xətlər', icon: BusFront, also: ['route'] },
  { kind: 'saved', label: 'Seçilmişlər', icon: Star },
];
const LAYERS: Layers = { buses: true, others: false, crowd: false };
const TOP_GAP = 56; // tam açıq paneldə üstdə qalan yer: status zolağı və xəritənin kənarı

function initialSnap(kind: View['kind']): SheetSnap {
  if (kind === 'home') return 'peek';
  if (kind === 'plan') return 'full';
  return 'half';
}

export function MobileApp() {
  const c = usePassenger('/mobile');
  const { net, error, live, connected, online, pos, locStatus, locate, prefs, setPrefs, saved, toggleStop, toggleRoute, install, setInstall, queued, from, setFrom, fitNonce, refit, journey, setJourney, view, go, back, dir, setDir, bg } = c;
  const { ref: stageRef, height: stage } = useStageHeight();
  const [snap, setSnap] = useState<SheetSnap>(() => initialSnap(view.kind));

  useEffect(() => setSnap(initialSnap(view.kind)), [view.kind, view.kind === 'stop' || view.kind === 'route' ? view.id : '']); // eslint-disable-line react-hooks/exhaustive-deps

  const scene = useScene({ net, live, view, dir, pos, fitNonce, journey, layers: LAYERS, bg });
  const visible = snapHeight(snap === 'full' ? 'half' : snap, stage, TOP_GAP);
  const pad = useMemo(() => ({ tl: [24, 76] as [number, number], br: [24, visible + 16] as [number, number] }), [visible]);

  const page = view.kind === 'lines' || view.kind === 'saved' || view.kind === 'search' || prefs.simple;
  const onStop = (id: string) => go({ kind: 'stop', id });
  const onRoute = (id: string) => go({ kind: 'route', id });
  const activeTab = TABS.find((t) => t.kind === view.kind || t.also?.includes(view.kind))?.kind ?? 'home';

  const theme = useResolvedTheme(prefs.theme);
  const cls = ['passenger', 'mobile-app', theme === 'dark' && 'dark', prefs.contrast && 'contrast', prefs.large && 'large'].filter(Boolean).join(' ');

  const settings = (
    <section className="m-settings" aria-labelledby="settings-title">
      <h2 id="settings-title" className="list-title">
        Görünüş
      </h2>
      <label>
        <span>Sadə rejim</span>
        <small>Xəritəsiz, yalnız növbəti 3 avtobus</small>
        <input type="checkbox" role="switch" checked={prefs.simple} onChange={(e) => setPrefs({ simple: e.target.checked })} />
      </label>
      <label>
        <span>Böyük şrift</span>
        <input type="checkbox" role="switch" checked={prefs.large} onChange={(e) => setPrefs({ large: e.target.checked })} />
      </label>
      <label>
        <span>Yüksək kontrast</span>
        <input type="checkbox" role="switch" checked={prefs.contrast} onChange={(e) => setPrefs({ contrast: e.target.checked })} />
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
          <Download size={16} aria-hidden /> Telefona quraşdır
        </button>
      )}
      <a className="m-link" href="/?desktop=1">
        <Monitor size={16} aria-hidden /> Kompüter versiyası
      </a>
      <p className="source">
        Xətlər, dayanacaqlar və gündəlik gedişlər: opendata.az (AYNA, Bakı Metropoliteni). Avtobusların hərəkəti və sıxlıq demo üçün simulyasiyadır. {connected ? 'Canlı məlumat qoşulub.' : 'Canlı məlumata qoşulur…'}
      </p>
    </section>
  );

  const body = !net ? (
    <div className="view">{error ? <p className="hint err">{error}</p> : <p className="hint">Yüklənir…</p>}</div>
  ) : view.kind === 'search' ? (
    <SearchView net={net} onClose={back} onStop={onStop} onRoute={onRoute} />
  ) : view.kind === 'lines' ? (
    <LinesView net={net} live={live} savedRoutes={saved.routes} onRoute={onRoute} />
  ) : view.kind === 'saved' ? (
    <SavedView net={net} saved={saved} onStop={onStop} onRoute={onRoute}>
      {settings}
    </SavedView>
  ) : view.kind === 'stop' ? (
    <StopView net={net} stopId={view.id} pos={pos} simple={prefs.simple} starred={saved.stops.includes(view.id)} onStar={() => toggleStop(view.id)} onBack={back} onRoute={onRoute} />
  ) : view.kind === 'route' ? (
    <RouteView net={net} live={live} routeId={view.id} dir={dir} setDir={setDir} starred={saved.routes.includes(view.id)} onStar={() => toggleRoute(view.id)} onBack={back} onStop={onStop} />
  ) : view.kind === 'plan' ? (
    <PlannerView
      net={net}
      pos={pos}
      from={from}
      setFrom={setFrom}
      onBack={back}
      showHead={false}
      onJourney={(j) => {
        setJourney(j);
        if (j) setSnap('half');
      }}
    />
  ) : (
    <HomeView net={net} pos={pos} locStatus={locStatus} compact onLocate={locate} onStop={onStop} onRoute={onRoute} onPlan={() => go({ kind: 'plan' })} />
  );

  return (
    <div className={cls}>
      <a href="#m-main" className="skip">
        Əsas məzmuna keç
      </a>
      <div className="m-stage" ref={stageRef}>
        {!prefs.simple && (
          <div className="p-map">
            <MapView theme="light" background={scene.background} lines={scene.lines} buses={scene.buses} stops={scene.stops} arrows={scene.arrows} arrowColor={scene.arrowColor} user={pos} fit={scene.fit} pad={pad} onStopClick={onStop} label="Xəritə: xətlər, avtobuslar və sizin yeriniz" />
          </div>
        )}

        {!page && snap !== 'full' && (
          <div className="m-top">
            {view.kind === 'home' ? (
              <button type="button" className="search-bar" onClick={() => go({ kind: 'search' })}>
                <Search size={18} aria-hidden />
                <span>Dayanacaq və ya xətt axtar</span>
              </button>
            ) : (
              <button type="button" className="fab" onClick={back} aria-label="Geri">
                <ArrowLeft size={20} aria-hidden />
              </button>
            )}
          </div>
        )}

        {!page && snap !== 'full' && (
          <button
            type="button"
            className={`fab m-locate ${locStatus === 'on' ? 'on' : ''}`}
            style={{ bottom: snapHeight(snap, stage, TOP_GAP) + 12 }}
            onClick={() => {
              locate();
              refit();
            }}
            aria-label="Yerimi göstər"
            title={locStatus === 'denied' ? 'Yer icazəsi verilməyib' : 'Yerimi göstər'}
          >
            <LocateFixed size={20} aria-hidden />
          </button>
        )}

        {(!online || queued > 0) && (
          <p className="offline" role="status">
            <WifiOff size={16} aria-hidden /> {online ? `${queued} bildiriş göndərilməyi gözləyir` : 'İnternet yoxdur. Bildirişlər yadda saxlanılır.'}
          </p>
        )}

        {page ? (
          <main id="m-main" className="m-page">
            {prefs.simple && !['search', 'lines', 'saved'].includes(view.kind) && (
              <button type="button" className="search-bar flat" onClick={() => go({ kind: 'search' })}>
                <Search size={18} aria-hidden />
                <span>Dayanacaq və ya xətt axtar</span>
              </button>
            )}
            {body}
          </main>
        ) : (
          <BottomSheet snap={snap} onSnap={setSnap} stage={stage} top={TOP_GAP} label="Məlumat paneli">
            <main id="m-main">{body}</main>
          </BottomSheet>
        )}
      </div>

      <nav className="m-tabs" aria-label="Bölmələr">
        {TABS.map((t) => (
          <button key={t.kind} type="button" aria-current={activeTab === t.kind ? 'page' : undefined} onClick={() => go({ kind: t.kind } as View)}>
            <t.icon size={22} aria-hidden />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
