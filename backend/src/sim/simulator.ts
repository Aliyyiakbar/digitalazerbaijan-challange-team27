// AYNA-nın açıq GPS/AVL axını olmadığı üçün avtobus parkı simulyasiya olunur.
// Model sadə, amma fiziki cəhətdən dürüstdür:
//   • sərnişinlər hər dayanacağa (istiqamət üzrə) günün saatına və xəttin tələbatına görə gəlir;
//   • avtobus dayanacaqda minənlərin sayına görə dayanır (dolu avtobus daha uzun dayanır);
//   • nəticədə avtobusların toplanması (bunching) özü-özünə yaranır — real həyatdakı kimi;
//   • "dürüst" sərnişinlər avtobusun HƏQİQİ doluluğuna uyğun (bəzən səhv) bildiriş göndərir.
// Ssenarilər demoda canlı göstərmək üçündür və UI-da açıq şəkildə "simulyasiya" kimi işarələnir.
import type { Network, RouteInfo } from '../engine/network.js';
import type { Level, ReportContext } from '../engine/types.js';
import { aheadDistance, pointAt } from '../lib/geo.js';

export interface SimSink {
  now(): number;
  gps(p: { busId: string; routeId: string; lat: number; lon: number; label?: string; reserve?: boolean; dir?: 0 | 1 }): void;
  report(r: { routeId: string; busId?: string; stopId?: string; context: ReportContext; level: Level; deviceId: string; ip: string; lat?: number; lon?: number; accuracy?: number; source: 'sim' | 'bot' }): Promise<unknown>;
}

interface SimBus {
  id: string;
  routeId: string;
  label: string;
  d: number;
  load: number;
  dwellLeft: number;
  holdLeft: number;
  reserve: boolean;
  lastStopSeq: number;
}

export type ScenarioName = 'peak' | 'fake' | 'bots' | 'traffic' | 'bunch';

interface ActiveScenario {
  name: ScenarioName;
  routeId: string;
  until: number;
  state?: Record<string, unknown>;
}

export const FREE_FLOW = 8.5; // m/s

/** Bakı vaxtı ilə günün saatına görə tələbat profili (0..1). */
export function demandProfile(ts: number): number {
  const m = (((ts / 60_000 + 240) % 1440) + 1440) % 1440; // UTC+4
  const h = m / 60;
  const bump = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  return Math.min(1.1, 0.18 + 0.85 * bump(8.4, 0.9) + 0.75 * bump(18.6, 1.1) + 0.3 * bump(13.2, 1.6));
}

/** Günün profilinin inteqralı (saniyə): gündəlik gedişi saniyəlik intensivliyə çevirmək üçün. */
export const PROFILE_INTEGRAL_S = (() => {
  let s = 0;
  for (let m = 0; m < 1440; m++) s += demandProfile(Date.UTC(2026, 0, 1, 0, m) - 4 * 3600_000) * 60;
  return s;
})();
/** Kalibrləmə əmsalı: validasiya sayı ≠ unikal sərnişin; ehtiyat və pik saatın kəskinliyi üçün. */
export const DEMAND_SCALE = Number(process.env.DEMAND_SCALE ?? 1.3);

export function trueLevel(load: number, capacity: number): Level {
  const r = load / capacity;
  return r >= 0.85 ? 3 : r >= 0.5 ? 2 : 1;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export class Simulator {
  buses = new Map<string, SimBus>();
  waiting = new Map<string, number>(); // `${routeId}|${seq}`
  scenarios: ActiveScenario[] = [];
  private rand = rng(42);
  private lastTs: number;
  private honest: Array<{ id: string; ip: string }>;
  private botCounter = 0;

  constructor(
    private net: Network,
    private sink: SimSink,
  ) {
    this.lastTs = sink.now();
    this.honest = Array.from({ length: 3000 }, (_, i) => ({ id: `sim-dev-${i}`, ip: `10.${(i * 7) % 250}.${i % 200}.${(i * 13) % 250}` }));
    for (const r of net.routes.values()) {
      const L = r.path.length;
      for (let i = 0; i < r.plannedBuses; i++) {
        // bərabər yayılmış, kiçik təsadüfi sürüşmə ilə
        const d = ((i / r.plannedBuses) * L + this.rand() * 300) % L;
        this.addBus(r, `${r.id}-${i + 1}`, `${r.id}·${i + 1}`, d, false);
      }
      for (const ls of r.loopStops) this.waiting.set(`${r.id}|${ls.seq}`, 3 + this.rand() * 6);
    }
  }

  private addBus(r: RouteInfo, id: string, label: string, d: number, reserve: boolean) {
    const b: SimBus = { id, routeId: r.id, label, d, load: r.capacity * (0.15 + this.rand() * 0.25), dwellLeft: 0, holdLeft: 0, reserve, lastStopSeq: -1 };
    this.buses.set(id, b);
    this.emitGps(b);
  }

  command(c: { type: string; [k: string]: unknown }): void {
    if (c.type === 'add-bus') {
      const r = this.net.routes.get(String(c.routeId));
      if (r) this.addBus(r, String(c.busId), String(c.label ?? c.busId), Number(c.d ?? 0), !!c.reserve);
    } else if (c.type === 'remove-bus') {
      this.buses.delete(String(c.busId));
    }
  }

  scenario(name: ScenarioName | 'reset', routeId?: string): { ok: boolean; message: string } {
    const now = this.sink.now();
    if (name === 'reset') {
      this.scenarios = [];
      return { ok: true, message: 'Bütün ssenarilər dayandırıldı' };
    }
    const defaults: Record<ScenarioName, string> = { peak: '14', fake: '5', bots: 'M2', traffic: '6', bunch: '88' };
    const rid = routeId && this.net.routes.has(routeId) ? routeId : defaults[name];
    const dur: Record<ScenarioName, number> = { peak: 30, fake: 15, bots: 3, traffic: 15, bunch: 1 };
    this.scenarios = this.scenarios.filter((s) => !(s.name === name && s.routeId === rid));
    const sc: ActiveScenario = { name, routeId: rid, until: now + dur[name] * 60_000, state: {} };
    if (name === 'bunch' || name === 'fake') this.forceBunch(rid);
    if (name === 'fake') {
      // toplanmış cütün arxasındakı (boş) avtobusu hədəf seç
      const pair = this.bunchedPair(rid);
      if (pair) {
        pair.follower.load = 6; // həqiqətən boşdur
        sc.state = { target: pair.follower.id, label: pair.follower.label };
      }
    }
    this.scenarios.push(sc);
    const names: Record<ScenarioName, string> = {
      peak: `${rid} xəttində pik saat tələbatı (×3, 30 dəq)`,
      fake: `${rid}: boş gedən avtobusa "yüksək" bildirişləri`,
      bots: `${rid} xəttinə bot hücumu`,
      traffic: `${rid} xəttində tıxac (sürət ×0.3, 15 dəq)`,
      bunch: `${rid} xəttində iki avtobus toplanır`,
    };
    return { ok: true, message: names[name] };
  }

  private forceBunch(routeId: string) {
    const list = [...this.buses.values()].filter((b) => b.routeId === routeId).sort((a, b) => a.d - b.d);
    if (list.length < 2) return;
    const r = this.net.routes.get(routeId)!;
    const leader = list[0];
    const follower = list[1];
    follower.d = (leader.d - 120 + r.path.length) % r.path.length;
    leader.load = r.capacity * 0.97;
    leader.lastStopSeq = -1;
    follower.lastStopSeq = -1;
  }

  private bunchedPair(routeId: string): { leader: SimBus; follower: SimBus } | null {
    const r = this.net.routes.get(routeId)!;
    const list = [...this.buses.values()].filter((b) => b.routeId === routeId);
    for (const f of list)
      for (const l of list) if (f !== l && aheadDistance(f.d, l.d, r.path.length) < 400) return { leader: l, follower: f };
    return null;
  }

  private active(name: ScenarioName, routeId: string, now: number) {
    return this.scenarios.find((s) => s.name === name && s.routeId === routeId && s.until > now);
  }

  /** Bir addım. dtS = simulyasiya saniyələri. */
  async step(): Promise<void> {
    const now = this.sink.now();
    const dt = Math.min(120, Math.max(0, (now - this.lastTs) / 1000));
    this.lastTs = now;
    if (dt === 0) return;
    this.scenarios = this.scenarios.filter((s) => s.until > now);
    const profile = demandProfile(now);
    const reports: Array<Promise<unknown>> = [];

    for (const r of this.net.routes.values()) {
      const peak = this.active('peak', r.id, now) ? 3 : 1;
      const traffic = this.active('traffic', r.id, now) ? 0.3 : 1;
      // real gündəlik gediş (opendata.az) × həftə günü əmsalı × günün saatı profili → nəfər/san hər dayanacaqda
      const dow = r.ridership.dow[new Date(now + 4 * 3600_000).getUTCDay()] ?? 1;
      const lambda = (DEMAND_SCALE * r.ridership.recentDaily * dow * profile * peak) / (r.loopStops.length * PROFILE_INTEGRAL_S);
      for (const ls of r.loopStops) {
        const k = `${r.id}|${ls.seq}`;
        this.waiting.set(k, Math.min(160, (this.waiting.get(k) ?? 0) + lambda * dt));
      }
      const L = r.path.length;
      for (const b of [...this.buses.values()].filter((x) => x.routeId === r.id)) {
        let remaining = dt;
        // dayanacaqda dayanma
        if (b.dwellLeft > 0) {
          const used = Math.min(remaining, b.dwellLeft);
          b.dwellLeft -= used;
          remaining -= used;
        }
        if (remaining > 0) {
          const v = FREE_FLOW * traffic * (0.8 + this.rand() * 0.35) * (b.load > r.capacity * 0.9 ? 0.93 : 1);
          const step = v * remaining;
          // yolda keçilən dayanacaqlar
          const passed = r.loopStops.filter((ls) => {
            const a = aheadDistance(b.d, ls.d, L);
            return a > 0.5 && a <= step;
          });
          if (passed.length) {
            const ls = passed.sort((x, y) => aheadDistance(b.d, x.d, L) - aheadDistance(b.d, y.d, L))[0];
            b.d = ls.d;
            this.serveStop(r, b, ls.seq, ls.d);
          } else {
            b.d = (b.d + step) % L;
          }
        }
        this.emitGps(b);

        // dürüst bildirişlər — doluluqla mütənasib
        const fakeTarget = this.active('fake', r.id, now)?.state?.target;
        const p = (b.load * 0.0045 * dt) / 60;
        if (b.id !== fakeTarget && this.rand() < p) {
          const lvl = this.noisy(trueLevel(b.load, r.capacity));
          const dev = this.honest[Math.floor(this.rand() * this.honest.length)];
          const [lat, lon] = this.jitter(pointAt(r.path, b.d), 40);
          reports.push(this.sink.report({ routeId: r.id, busId: b.id, context: 'bus', level: lvl, deviceId: dev.id, ip: dev.ip, lat, lon, accuracy: 15, source: 'sim' }));
        }
      }
      // dayanacaqda gözləyənlərin bildirişləri
      for (const ls of r.loopStops) {
        const w = this.waiting.get(`${r.id}|${ls.seq}`) ?? 0;
        if (w > 12 && this.rand() < (w * 0.0012 * dt) / 60) {
          const s = this.net.stops.get(ls.stopId)!;
          const dev = this.honest[Math.floor(this.rand() * this.honest.length)];
          const [lat, lon] = this.jitter([s.lat, s.lon], 50);
          reports.push(this.sink.report({ routeId: r.id, stopId: ls.stopId, context: 'stop', level: w > 45 ? 3 : w > 20 ? 2 : 1, deviceId: dev.id, ip: dev.ip, lat, lon, accuracy: 20, source: 'sim' }));
        }
      }
    }

    // --- ssenari: boş avtobusa saxta "yüksək"
    for (const sc of this.scenarios.filter((s) => s.name === 'fake')) {
      const target = this.buses.get(String(sc.state?.target));
      if (!target) continue;
      target.load = Math.min(target.load, 10);
      if (this.rand() < (2.2 * dt) / 60) {
        // 6 cihazlıq qrup: ikisi avtobusun yanında, qalanları evdən (3-5 km uzaqda)
        const i = Math.floor(this.rand() * 6);
        const r = this.net.routes.get(sc.routeId)!;
        const near = i < 2;
        const base = pointAt(r.path, target.d);
        const [lat, lon] = near ? this.jitter(base, 50) : this.jitter([base[0] + 0.03, base[1] + 0.02], 300);
        reports.push(this.sink.report({ routeId: sc.routeId, busId: target.id, context: 'bus', level: 3, deviceId: `sim-dev-fake-${i}`, ip: `10.99.0.${i}`, lat, lon, accuracy: 25, source: 'sim' }));
      }
    }
    // --- ssenari: bot hücumu (saniyədə ~1 bildiriş, eyni ritm, 2 IP, koordinatsız, yeni cihazlar)
    for (const sc of this.scenarios.filter((s) => s.name === 'bots')) {
      const n = Math.max(1, Math.round(dt));
      const target = [...this.buses.values()].find((b) => b.routeId === sc.routeId);
      for (let k = 0; k < n; k++) {
        this.botCounter++;
        reports.push(
          this.sink.report({ routeId: sc.routeId, busId: target?.id, context: 'bus', level: 3, deviceId: `bot-${this.botCounter % 40}-${Math.floor(this.botCounter / 40)}`, ip: `203.0.113.${this.botCounter % 2}`, source: 'bot' }),
        );
      }
    }
    await Promise.allSettled(reports);
  }

  private serveStop(r: RouteInfo, b: SimBus, seq: number, d: number) {
    if (b.lastStopSeq === seq) return;
    b.lastStopSeq = seq;
    const k = `${r.id}|${seq}`;
    const w = this.waiting.get(k) ?? 0;
    const terminal = seq === 0 || Math.abs(d - r.forwardLength) < 5;
    // orta səfər ~6 km: hər dayanacaqda düşənlərin payı dayanacaqlar arası məsafədən asılıdır
    const spacing = r.path.length / Math.max(1, r.loopStops.length);
    const frac = Math.min(0.4, Math.max(0.04, spacing / 6000));
    const alight = terminal ? b.load : b.load * frac * (0.8 + this.rand() * 0.4);
    b.load -= alight;
    const board = Math.min(w, r.capacity - b.load);
    b.load += board;
    this.waiting.set(k, w - board);
    b.dwellLeft = Math.min(150, 6 + 1.6 * board + 0.7 * alight);
  }

  private noisy(l: Level): Level {
    const x = this.rand();
    if (x < 0.08) return Math.max(1, l - 1) as Level;
    if (x < 0.14) return Math.min(3, l + 1) as Level;
    return l;
  }

  private jitter([lat, lon]: [number, number], meters: number): [number, number] {
    const a = this.rand() * Math.PI * 2;
    const m = this.rand() * meters;
    return [lat + (Math.cos(a) * m) / 111_000, lon + (Math.sin(a) * m) / (111_000 * Math.cos((lat * Math.PI) / 180))];
  }

  private emitGps(b: SimBus) {
    const r = this.net.routes.get(b.routeId)!;
    const [lat, lon] = pointAt(r.path, b.d);
    // real GPS kimi kiçik səs-küy (±6 m)
    const [jl, jo] = this.jitter([lat, lon], 6);
    this.sink.gps({ busId: b.id, routeId: b.routeId, lat: jl, lon: jo, label: b.label, reserve: b.reserve, dir: b.d < r.forwardLength ? 0 : 1 });
  }

  state() {
    return {
      scenarios: this.scenarios.map((s) => ({ name: s.name, routeId: s.routeId, until: s.until, target: s.state?.label ?? null })),
      buses: this.buses.size,
      waiting: Math.round([...this.waiting.values()].reduce((a, b) => a + b, 0)),
    };
  }
}
