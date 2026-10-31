// Real vaxt store-u (Redis). Burada yaşayır:
//   bus:pos            HASH  — hər avtobusun son mövqeyi (JSON)
//   win:{routeId}      ZSET  — son 10+ dəqiqənin bildirişləri (score = sim vaxtı)
//   rl:{key}           STR   — spam limiti (real vaxt TTL)
//   events             PUB/SUB — WebSocket yayımı üçün hadisələr (bir neçə backend instansı ola bilər)
// REDIS_URL verilməyibsə (testlər), eyni interfeysli yaddaşdaxili versiya işləyir.
import type { CrowdReport } from '../engine/types.js';

export interface LiveStore {
  kind: 'redis' | 'memory';
  setBusPositions(entries: Record<string, string>): Promise<void>;
  removeBus(busId: string): Promise<void>;
  addReport(r: CrowdReport): Promise<void>;
  updateReport(r: CrowdReport): Promise<void>;
  reports(routeId: string, sinceTs: number): Promise<CrowdReport[]>;
  prune(beforeTs: number, routeIds: string[]): Promise<void>;
  /** true = icazə var. key üzrə windowMs ərzində ən çox `max` əməliyyat. */
  rateLimit(key: string, windowMs: number, max: number): Promise<boolean>;
  publish(msg: unknown): Promise<void>;
  subscribe(fn: (msg: unknown) => void): Promise<void>;
  close(): Promise<void>;
}

export async function openStore(redisUrl: string): Promise<LiveStore> {
  if (!redisUrl) return new MemoryStore();
  const { Redis } = await import('ioredis');
  const r = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
  const sub = new Redis(redisUrl);
  await r.ping();
  const subs: Array<(m: unknown) => void> = [];
  sub.on('message', (_ch, raw) => {
    const m = JSON.parse(raw);
    for (const f of subs) f(m);
  });
  return {
    kind: 'redis',
    async setBusPositions(entries) {
      if (Object.keys(entries).length) await r.hset('bus:pos', entries);
    },
    async removeBus(busId) {
      await r.hdel('bus:pos', busId);
    },
    async addReport(rep) {
      await r.zadd(`win:${rep.routeId}`, rep.ts, JSON.stringify(rep));
    },
    async updateReport(rep) {
      // köhnə üzvü id ilə tap və əvəz et
      const all = await r.zrangebyscore(`win:${rep.routeId}`, rep.ts, rep.ts);
      const old = all.find((m) => (JSON.parse(m) as CrowdReport).id === rep.id);
      const tx = r.multi();
      if (old) tx.zrem(`win:${rep.routeId}`, old);
      tx.zadd(`win:${rep.routeId}`, rep.ts, JSON.stringify(rep));
      await tx.exec();
    },
    async reports(routeId, sinceTs) {
      const raw = await r.zrangebyscore(`win:${routeId}`, sinceTs, '+inf');
      return raw.map((m) => JSON.parse(m) as CrowdReport);
    },
    async prune(beforeTs, routeIds) {
      const tx = r.multi();
      for (const id of routeIds) tx.zremrangebyscore(`win:${id}`, '-inf', beforeTs);
      await tx.exec();
    },
    async rateLimit(key, windowMs, max) {
      const k = `rl:${key}`;
      const n = await r.incr(k);
      if (n === 1) await r.pexpire(k, windowMs);
      return n <= max;
    },
    async publish(msg) {
      await r.publish('events', JSON.stringify(msg));
    },
    async subscribe(fn) {
      subs.push(fn);
      if (subs.length === 1) await sub.subscribe('events');
    },
    async close() {
      r.disconnect();
      sub.disconnect();
    },
  };
}

export class MemoryStore implements LiveStore {
  kind = 'memory' as const;
  private pos = new Map<string, string>();
  private win = new Map<string, CrowdReport[]>();
  private rl = new Map<string, { n: number; until: number }>();
  private subs: Array<(m: unknown) => void> = [];

  async setBusPositions(entries: Record<string, string>) {
    for (const [k, v] of Object.entries(entries)) this.pos.set(k, v);
  }
  async removeBus(busId: string) {
    this.pos.delete(busId);
  }
  async addReport(r: CrowdReport) {
    if (!this.win.has(r.routeId)) this.win.set(r.routeId, []);
    this.win.get(r.routeId)!.push(r);
  }
  async updateReport(r: CrowdReport) {
    const list = this.win.get(r.routeId) ?? [];
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list[i] = r;
  }
  async reports(routeId: string, sinceTs: number) {
    return (this.win.get(routeId) ?? []).filter((r) => r.ts >= sinceTs);
  }
  async prune(beforeTs: number, routeIds: string[]) {
    for (const id of routeIds) this.win.set(id, (this.win.get(id) ?? []).filter((r) => r.ts >= beforeTs));
  }
  async rateLimit(key: string, windowMs: number, max: number) {
    const now = Date.now();
    const e = this.rl.get(key);
    if (!e || e.until < now) {
      this.rl.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    e.n++;
    return e.n <= max;
  }
  async publish(msg: unknown) {
    for (const f of this.subs) f(msg);
  }
  async subscribe(fn: (m: unknown) => void) {
    this.subs.push(fn);
  }
  async close() {}
}
