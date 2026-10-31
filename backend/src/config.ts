import { randomBytes } from 'node:crypto';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  /** PostgreSQL bağlantısı. Boşdursa PGlite (WASM Postgres) lokal fayl bazası istifadə olunur. */
  databaseUrl: env.DATABASE_URL ?? '',
  pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
  /** Redis bağlantısı. Boşdursa yaddaşdaxili store (yalnız test/dev üçün). */
  redisUrl: env.REDIS_URL ?? '',
  /** in-process: simulyator backend daxilində işləyir; external: ayrıca proses HTTP ilə göndərir; off */
  simMode: (env.SIM_MODE ?? 'in-process') as 'in-process' | 'external' | 'off',
  simSpeed: Number(env.SIM_SPEED ?? 1),
  /** Simulyasiya saatının başlanğıcı (Bakı vaxtı ilə pik saat ki, demo dərhal maraqlı olsun). */
  simStart: env.SIM_START ?? '',
  tokenSecret: env.TOKEN_SECRET ?? randomBytes(16).toString('hex'),
  internalKey: env.INTERNAL_KEY ?? 'dev-internal-key',
  corsOrigin: env.CORS_ORIGIN ?? '*',
  staticDir: env.STATIC_DIR ?? '',
};
