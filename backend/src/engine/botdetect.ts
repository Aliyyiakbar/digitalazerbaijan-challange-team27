// Bot / saxta bildiriş hücumunun aşkarlanması.
// Xətt üzrə son 5 dəqiqənin bildirişlərinə baxılır və bir neçə siqnal yoxlanılır.
// İki və daha çox siqnal birlikdə görünərsə — hücum sayılır və şübhəli bildirişlər karantinə düşür.
import type { CrowdReport } from './types.js';

export const BOT_WINDOW_MS = 5 * 60_000;

export interface DeviceMeta {
  firstSeen: number;
}

export interface BotVerdict {
  attack: boolean;
  signals: string[];
  suspiciousIds: Set<string>;
  ratePerMin: number;
  baselinePerMin: number;
}

export function detectBots(
  reports: CrowdReport[],
  now: number,
  devices: Map<string, DeviceMeta>,
  baselinePerMin: number,
): BotVerdict {
  const recent = reports.filter((r) => now - r.ts <= BOT_WINDOW_MS && r.ts <= now && r.source !== 'sim');
  const all = reports.filter((r) => now - r.ts <= BOT_WINDOW_MS && r.ts <= now);
  const signals: string[] = [];
  const suspicious = new Set<string>();
  const lastMin = all.filter((r) => now - r.ts <= 60_000).length;
  const base = Math.max(1, baselinePerMin);

  // 1) sürət sıçrayışı
  const burst = lastMin >= Math.max(12, base * 5);
  if (burst) signals.push(`Son dəqiqədə ${lastMin} bildiriş (adi səviyyə ~${base.toFixed(1)}/dəq)`);

  // 2) bir IP-dən çoxlu cihaz
  const byIp = new Map<string, Set<string>>();
  for (const r of recent) {
    if (!byIp.has(r.ip)) byIp.set(r.ip, new Set());
    byIp.get(r.ip)!.add(r.deviceId);
  }
  const badIps = [...byIp.entries()].filter(([, d]) => d.size >= 4).map(([ip]) => ip);
  if (badIps.length) {
    signals.push(`${badIps.length} IP ünvanından 4+ fərqli cihaz`);
    for (const r of recent) if (badIps.includes(r.ip)) suspicious.add(r.id);
  }

  // 3) maşın ritmi: bildirişlər arası intervallar həddən artıq bərabərdir
  const sorted = [...recent].sort((a, b) => a.ts - b.ts);
  if (sorted.length >= 8) {
    const gaps = sorted.slice(1).map((r, i) => r.ts - sorted[i].ts);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (mean > 0 && sd / mean < 0.15) signals.push('Bildirişlər arası intervallar maşın kimi bərabərdir');
  }

  // 4) koordinatsız bildirişlərin payı
  if (recent.length >= 8) {
    const noGeo = recent.filter((r) => !r.hasGeo).length / recent.length;
    if (noGeo > 0.8) {
      signals.push(`Bildirişlərin ${Math.round(noGeo * 100)}%-i koordinatsızdır`);
      for (const r of recent) if (!r.hasGeo) suspicious.add(r.id);
    }
  }

  // 5) yeni yaranmış cihazların payı
  if (recent.length >= 8) {
    const fresh = recent.filter((r) => now - (devices.get(r.deviceId)?.firstSeen ?? now) < 2 * 60_000);
    if (fresh.length / recent.length > 0.7) {
      signals.push(`Bildirişlərin ${Math.round((fresh.length / recent.length) * 100)}%-i son 2 dəqiqədə yaranmış cihazlardandır`);
      for (const r of fresh) suspicious.add(r.id);
    }
  }

  const attack = signals.length >= 2 && (burst || badIps.length > 0);
  return { attack, signals, suspiciousIds: attack ? suspicious : new Set(), ratePerMin: lastMin, baselinePerMin: base };
}
