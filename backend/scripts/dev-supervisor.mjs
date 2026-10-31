#!/usr/bin/env node
// Sadə inkişaf supervisoru: src/ dəyişəndə serveri yenidən başladır.
// (`node --watch` IPC tələb edir, bəzi sandbox mühitlərində işləmir.)
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let child = null;
let timer = null;

function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code, sig) => {
    if (sig !== 'SIGTERM') console.log(`[supervisor] server dayandı (code=${code})`);
  });
}

function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('[supervisor] dəyişiklik — yenidən başladılır');
    if (child && child.exitCode == null) {
      child.once('exit', start);
      child.kill('SIGTERM');
    } else start();
  }, 300);
}

// fs.watch bəzi mühitlərdə EMFILE verir — sadə polling (src kiçikdir)
const mtimes = new Map();
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.(ts|sql|json)$/.test(e.name)) {
      const m = statSync(p).mtimeMs;
      if (mtimes.has(p) && mtimes.get(p) !== m) restart();
      mtimes.set(p, m);
    }
  }
}
scan(join(root, 'src'));
setInterval(() => scan(join(root, 'src')), 1000);
start();
