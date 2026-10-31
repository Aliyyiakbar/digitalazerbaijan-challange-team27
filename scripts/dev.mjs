#!/usr/bin/env node
// Lokal inkişaf: backend (8080) + frontend (5173) birlikdə.  node scripts/dev.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', VITE_BACKEND: process.env.VITE_BACKEND ?? `http://localhost:${process.env.PORT ?? 8080}` };

const procs = [
  spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: join(root, 'backend'), stdio: 'inherit', env }),
  spawn(process.execPath, [join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: join(root, 'frontend'), stdio: 'inherit', env }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (c) => c && c !== 0 && stop());
