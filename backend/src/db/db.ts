// Verilənlər bazası adapteri. Docker/production: PostgreSQL 16 (pg). Lokal: PGlite — WASM üzərində
// işləyən real PostgreSQL (eyni SQL), quraşdırma tələb etmir.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface Db {
  kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function openDb(databaseUrl: string, pgliteDir: string): Promise<Db> {
  if (databaseUrl) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: databaseUrl, max: 10 });
    // bağlantını yoxla (Docker-də DB hazır olana qədər bir neçə dəfə cəhd et)
    for (let i = 0; ; i++) {
      try {
        await pool.query('select 1');
        break;
      } catch (e) {
        if (i >= 20) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return {
      kind: 'postgres',
      async query(sql, params) {
        const r = await pool.query(sql, params as unknown[]);
        return r.rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (pgliteDir !== 'memory') mkdirSync(dirname(pgliteDir), { recursive: true });
  const db =pgliteDir === 'memory' ? new PGlite() : new PGlite(pgliteDir);
  await db.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params) {
      const r = await db.query(sql, params as unknown[]);
      return r.rows as never;
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

export async function migrate(db: Db): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
}
