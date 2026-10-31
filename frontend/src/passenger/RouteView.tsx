// Xətt: canlı avtobuslar və dayanacaqlar zaman xətti kimi (AYNA MaaS-dakı "marşrut üzrə bütün dayanacaqlar").
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { LiveState, Network } from '../api';
import { CrowdPill, RouteBadge } from '../components/Crowd';

export function RouteView({ net, live, routeId, onBack, onStop }: { net: Network; live: LiveState | null; routeId: string; onBack: () => void; onStop: (id: string) => void }) {
  const route = net.routes.find((r) => r.id === routeId)!;
  const [dir, setDir] = useState<0 | 1>(0);
  const buses = (live?.buses ?? []).filter((b) => b.routeId === routeId);
  const rv = live?.routes.find((r) => r.id === routeId);
  const stopName = (id: string) => net.stops.find((s) => s.id === id)?.name ?? id;
  const ls = route.loopStops.filter((s) => s.dir === dir);
  const towards = ls[0]?.towards ?? '';

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
      <header className="view-head">
        <button type="button" className="back" onClick={onBack} aria-label="Geri">
          <ArrowLeft size={20} aria-hidden />
        </button>
        <RouteBadge id={route.id} color={route.color} size="lg" />
        <div>
          <h1 id="route-title">{route.name}</h1>
          <p className="sub">
            {buses.length} avtobus xətdə · hər {route.headwayMin} dəq
            {rv?.crowd.level ? ` · sıxlıq: ${rv.crowd.level === 3 ? 'yüksək' : rv.crowd.level === 2 ? 'orta' : 'aşağı'}` : ''}
          </p>
        </div>
      </header>

      <div className="seg" role="radiogroup" aria-label="İstiqamət">
        {([0, 1] as const).map((d) => {
          const t = route.loopStops.find((s) => s.dir === d)?.towards ?? '';
          return (
            <button key={d} type="button" role="radio" aria-checked={dir === d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>
              → {t}
            </button>
          );
        })}
      </div>

      <ol className="timeline" aria-label={`${towards} istiqamətində dayanacaqlar`} style={{ ['--route' as string]: route.color }}>
        {ls.map((s) => (
          <li key={s.seq}>
            <button type="button" onClick={() => onStop(s.stopId)}>
              <span className="tl-dot" aria-hidden />
              <span className="tl-name">{stopName(s.stopId)}</span>
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

      <p className="source">
        Real məlumat: bu xətt üzrə gündə orta {route.ridership.recentDaily.toLocaleString('az')} gediş (son 30 gün, BakuBus validasiyaları, opendata.az).
      </p>
    </div>
  );
}
