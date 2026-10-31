// Proqnoz modeli və "vaxt maşını" üçün SİNTETİK tarixçə generatoru.
// Real AYNA məlumatı olmadığı üçün son 14 günün xətt sıxlığı simulyatorla eyni tələbat
// profilindən (səhər və axşam pik saatları) səs-küylə yaradılır və `synthetic = true` kimi
// işarələnir. Vaxt maşını sintetik sətirləri göstərmir, yalnız model onları öyrənir.
import type { Db } from '../db/db.js';
import { demandProfile } from '../sim/simulator.js';
import type { Network } from '../engine/network.js';

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

export async function generateHistory(db: Db, net: Network, endTs: number, days = 14): Promise<number> {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rows: string[] = [];
  const params: unknown[] = [];
  let n = 0;
  const flush = async () => {
    if (!rows.length) return;
    await db.query(`insert into snapshots(ts,route_id,score,confidence,buses,reports,synthetic) values ${rows.join(',')} on conflict do nothing`, params);
    rows.length = 0;
    params.length = 0;
  };
  const start = endTs - days * 86_400_000;
  for (let t = start; t < endTs; t += 15 * 60_000) {
    const day = new Date(t + 4 * 3600_000).getUTCDay();
    const weekend = day === 0 || day === 6 ? 0.65 : 1;
    const p = demandProfile(t) * weekend;
    for (const route of net.routes.values()) {
      const load = Math.max(0, Math.min(1.15, p * route.demand * 1.05 + gauss(r) * 0.08));
      const score = Math.max(1, Math.min(3, 1 + 2 * Math.max(0, (load - 0.25) / 0.75)));
      const i = params.length;
      rows.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},true)`);
      params.push(new Date(t), route.id, +score.toFixed(3), 0.7, route.plannedBuses, 0);
      n++;
      if (rows.length >= 500) await flush();
    }
  }
  await flush();
  return n;
}

// CLI: npm run history
if (process.argv[1]?.endsWith('history.ts')) {
  const { config } = await import('../config.js');
  const { openDb, migrate } = await import('../db/db.js');
  const { loadNetwork } = await import('../engine/network.js');
  const db = await openDb(config.databaseUrl, config.pgliteDir);
  await migrate(db);
  const n = await generateHistory(db, loadNetwork(), Date.now());
  console.log(`${n} sintetik sətir yazıldı`);
  await db.close();
}
