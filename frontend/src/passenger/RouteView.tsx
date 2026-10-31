// Xətt: gediş və qayıdış ayrıca. Hər istiqamətin dayanacaqları zaman xətti kimi, avtobuslar öz yerində.
import { useMemo } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import type { LiveState, Network } from '../api';
import { CrowdPill, RouteBadge } from '../components/Crowd';
import { RidershipChart } from '../components/RidershipChart';
import { fmtInt } from '../lib/format';

export function RouteView({ net, live, routeId, dir, setDir, starred, onStar, rich, onBack, onStop }: { net: Network; live: LiveState | null; routeId: string; dir: 0 | 1; setDir: (d: 0 | 1) => void; starred?: boolean; onStar?: () => void; rich?: boolean; onBack: () => void; onStop: (id: string) => void }) {
  const route = net.routes.find((r) => r.id === routeId)!;
  const allBuses = live?.buses;
  const buses = useMemo(() => (allBuses ?? []).filter((b) => b.routeId === routeId), [allBuses, routeId]);
  const rv = live?.routes.find((r) => r.id === routeId);
  const names = useMemo(() => new Map(net.stops.map((s) => [s.id, s.name])), [net]);
  const ls = useMemo(() => route.loopStops.filter((s) => s.dir === dir), [route, dir]);
  const towards = ls[0]?.towards ?? '';
  const onDir = buses.filter((b) => b.dir === dir).length;

  // hər avtobusu ən yaxın növbəti dayanacağın yanında göstər
  const busAt = useMemo(() => {
    const m = new Map<number, typeof buses>();
    for (const b of buses.filter((x) => x.dir === dir)) {
      const next = ls.find((s) => s.d >= b.d) ?? ls[ls.length - 1];
      if (!next) continue;
      if (!m.has(next.seq)) m.set(next.seq, []);
      m.get(next.seq)!.push(b);
    }
    return m;
  }, [buses, ls, dir]);

  return (
    <div className="view route">
      <header className="view-head route-head">
        <div className="route-head-actions">
          <button type="button" className="back" onClick={onBack} aria-label="Geri">
            <ArrowLeft size={20} aria-hidden />
          </button>
          <RouteBadge id={route.id} color={route.color} size="lg" />
          {onStar && (
            <button type="button" className={`star ${starred ? 'on' : ''}`} onClick={onStar} aria-pressed={!!starred} aria-label={starred ? 'Seçilmişlərdən çıxar' : 'Seçilmişlərə əlavə et'}>
              <Star size={20} aria-hidden />
            </button>
          )}
        </div>
        <div className="view-title">
          <h1 id="route-title" title={route.name}>{route.name}</h1>
          <p className="sub">
            {buses.length} avtobus xətdə · hər {route.headwayMin} dəq
            {rv?.crowd.level ? ` · sıxlıq: ${rv.crowd.level === 3 ? 'yüksək' : rv.crowd.level === 2 ? 'orta' : 'aşağı'}` : ''}
          </p>
        </div>
      </header>

      <div className="seg dirs" role="radiogroup" aria-label="İstiqamət">
        {([0, 1] as const).map((d) => {
          const t = route.loopStops.find((s) => s.dir === d)?.towards ?? '';
          const n = route.loopStops.filter((s) => s.dir === d).length;
          return (
            <button key={d} type="button" role="radio" aria-checked={dir === d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>
              <strong>{d === 0 ? 'Gediş' : 'Qayıdış'}</strong>
              <span className="seg-to">{t}</span>
              <span className="seg-n">{n} dayanacaq</span>
            </button>
          );
        })}
      </div>
      <p className="sub dir-note">
        {towards} istiqamətində {onDir} avtobus
      </p>

      <ol className="timeline" aria-label={`${towards} istiqamətində dayanacaqlar`} style={{ ['--route' as string]: route.color }}>
        {ls.map((s) => (
          <li key={s.seq}>
            <button type="button" onClick={() => onStop(s.stopId)}>
              <span className="tl-dot" aria-hidden />
              <span className="tl-name">{names.get(s.stopId) ?? s.stopId}</span>
            </button>
            {(busAt.get(s.seq) ?? []).map((b) => (
              <span key={b.id} className="tl-bus">
                <span className="tl-bus-label">{b.label} yaxınlaşır</span>
                <CrowdPill level={b.crowd.level} />
              </span>
            ))}
          </li>
        ))}
      </ol>

      {rich && route.ridership.series.length > 0 && (
        <section className="rich-chart" aria-labelledby="ridership-title" style={{ ['--route' as string]: route.color }}>
          <h2 id="ridership-title" className="list-title">
            Son {route.ridership.series.length} günün gedişləri
          </h2>
          <RidershipChart series={route.ridership.series} />
        </section>
      )}

      <p className="source">
        Real məlumat: bu xətt üzrə gündə orta {fmtInt(route.ridership.recentDaily)} gediş (son 30 gün, BakuBus validasiyaları, opendata.az). Gediş və qayıdış dayanacaqları açıq marşrut həndəsəsindən hesablanıb, ekspres xətlər hər dayanacaqda dayanmaya bilər.
      </p>
    </div>
  );
}
