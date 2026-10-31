// Ayrıca simulyator prosesi (SIM_MODE=external). Avtobus terminalı kimi davranır:
// GPS-i HTTP ilə /api/gps-ə, sərnişin bildirişlərini /api/reports-a göndərir,
// operatorun "ehtiyat avtobus" əmrlərini və ssenariləri WebSocket ilə alır.
import WebSocket from 'ws';
import { loadNetwork } from '../engine/network.js';
import { Simulator, type ScenarioName } from './simulator.js';

const API = process.env.API_URL ?? 'http://localhost:8080';
const KEY = process.env.INTERNAL_KEY ?? 'dev-internal-key';
const headers = { 'content-type': 'application/json', 'x-internal-key': KEY };

let simNow = Date.now();
let speed = 1;
let realAt = Date.now();
const now = () => simNow + (Date.now() - realAt) * speed;

async function syncClock() {
  const s = (await (await fetch(`${API}/api/sim/state`)).json()) as { now: number; speed: number };
  simNow = s.now;
  speed = s.speed;
  realAt = Date.now();
}

for (let i = 0; ; i++) {
  try {
    await syncClock();
    break;
  } catch {
    if (i > 60) throw new Error('Backend əlçatan deyil');
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const net = loadNetwork();
let gpsBatch: unknown[] = [];
const sim = new Simulator(net, {
  now,
  gps: (p) => gpsBatch.push(p),
  report: async (r) => {
    await fetch(`${API}/api/reports`, { method: 'POST', headers: { ...headers, 'x-sim-ip': r.ip }, body: JSON.stringify(r) }).catch(() => {});
  },
});

function connect() {
  const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { type: string; data: Record<string, unknown> };
    if (m.type === 'sim.command') {
      if (m.data.type === 'scenario') sim.scenario(m.data.name as ScenarioName | 'reset', m.data.routeId as string | undefined);
      else sim.command(m.data as { type: string });
    } else if (m.type === 'clock') syncClock().catch(() => {});
  });
  ws.on('close', () => setTimeout(connect, 2000));
  ws.on('error', () => {});
}
connect();

setInterval(async () => {
  await sim.step();
  const batch = gpsBatch;
  gpsBatch = [];
  if (batch.length) await fetch(`${API}/api/gps`, { method: 'POST', headers, body: JSON.stringify(batch) }).catch(() => {});
}, 1000);
setInterval(() => syncClock().catch(() => {}), 15_000);
console.log(`Simulyator işləyir → ${API}`);
