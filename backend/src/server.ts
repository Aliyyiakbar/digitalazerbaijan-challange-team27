// Giriş nöqtəsi: DB + Redis + Engine + (simulyator) + HTTP API + WebSocket.
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { openDb, migrate } from './db/db.js';
import { openStore } from './db/store.js';
import { SimClock } from './lib/clock.js';
import { loadNetwork } from './engine/network.js';
import { Engine } from './engine/engine.js';
import { Simulator } from './sim/simulator.js';
import { createApp } from './api/app.js';
import { generateHistory } from './seed/history.js';

function defaultStart(): number {
  // Bu gün, Bakı vaxtı ilə 07:50 — səhər pik saatından az əvvəl
  const now = new Date();
  const baku = new Date(now.getTime() + 4 * 3600_000);
  baku.setUTCHours(7, 50, 0, 0);
  return baku.getTime() - 4 * 3600_000;
}

const db = await openDb(config.databaseUrl, config.pgliteDir);
await migrate(db);
const store = await openStore(config.redisUrl);
const clock = new SimClock(config.simStart ? Date.parse(config.simStart) : defaultStart(), config.simSpeed);
const net = loadNetwork();

const [{ n }] = await db.query<{ n: string }>('select count(*)::text as n from snapshots where synthetic = true');
if (Number(n) === 0) {
  const t0 = Date.now();
  const rows = await generateHistory(db, net, clock.now());
  console.log(`[seed] proqnoz modeli üçün ${rows} sintetik tarixçə sətri (${Date.now() - t0} ms)`);
}

const engine = new Engine(net, clock, db, store, { reservePool: Number(process.env.RESERVE_POOL ?? 6) });
await engine.init();

let sim: Simulator | null = null;
if (config.simMode === 'in-process') {
  sim = new Simulator(net, {
    now: () => clock.now(),
    gps: (p) => engine.ingestGps(p),
    report: (r) => engine.submitReport(r),
  });
  engine.on('sim', (c) => sim!.command(c));
  setInterval(() => sim!.step().catch((e) => console.error('[sim]', e)), 1000);
} else if (config.simMode === 'external') {
  // ayrıca simulyator prosesi əmrləri WebSocket üzərindən alır
  engine.on('sim', (c) => store.publish({ type: 'sim.command', data: c }).catch(() => {}));
}

engine.start(Number(process.env.ENGINE_TICK_MS ?? 1000));

const app = createApp({
  engine,
  sim,
  simCommand: (c) => store.publish({ type: 'sim.command', data: c }).catch(() => {}),
  tokenSecret: config.tokenSecret,
  internalKey: config.internalKey,
  corsOrigin: config.corsOrigin,
  staticDir: config.staticDir,
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', data: { now: clock.now(), speed: clock.speed } }));
  ws.send(JSON.stringify({ type: 'state', data: engine.liveState() }));
});
// Redis pub/sub → bütün WebSocket müştəriləri (bir neçə backend instansı da işləyə bilər)
await store.subscribe((msg) => {
  const raw = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(raw);
});

server.listen(config.port, () => {
  console.log(`Smart Transit Baku backend: http://localhost:${config.port}  (db=${db.kind}, store=${store.kind}, sim=${config.simMode}, speed=×${clock.speed})`);
  console.log(`API sənədi: http://localhost:${config.port}/api/docs`);
});

const shutdown = async () => {
  engine.stop();
  wss.close();
  server.close();
  await store.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
