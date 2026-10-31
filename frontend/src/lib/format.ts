import type { Badge, Level } from '../api';

export const LEVEL_TEXT: Record<Level, { label: string; long: string; key: 'low' | 'medium' | 'high' }> = {
  1: { label: 'Yer var', long: 'Aşağı sıxlıq, oturacaq tapmaq olar', key: 'low' },
  2: { label: 'Orta', long: 'Orta sıxlıq, ayaq üstə yer var', key: 'medium' },
  3: { label: 'Çox sıx', long: 'Yüksək sıxlıq, minmək çətindir', key: 'high' },
};

export const BADGE_TEXT: Record<Badge, string> = {
  confirmed: 'Təsdiqlənib',
  check: 'Yoxlanılmalı',
  suspicious: 'Şübhəli',
  none: 'Bildiriş yoxdur',
};

export function fmtEta(s: number): string {
  if (s < 45) return 'indi';
  const m = Math.round(s / 60);
  return `${m} dəq`;
}

/** Min ayırıcısı nöqtədir: 18.398. Brauzerdə "az" dili olmaya bilər, ona görə Intl-ə güvənilmir. */
export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fmtMin(s: number): string {
  return `${Math.max(1, Math.round(s / 60))} dəq`;
}

/** Bakı vaxtı (UTC+4) ilə saat:dəqiqə */
export function fmtClock(ts: number): string {
  const d = new Date(ts + 4 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtScore(s: number | null): string {
  return s == null ? '—' : s.toFixed(1);
}

export function levelOf(score: number | null): Level | null {
  if (score == null) return null;
  return score >= 2.4 ? 3 : score >= 1.6 ? 2 : 1;
}

export function pct(x: number | null | undefined): string {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}

export const CAUSE_TEXT: Record<string, string> = {
  normal: 'Normal',
  demand: 'Tələbat',
  traffic: 'Tıxac',
  mixed: 'Tıxac + tələbat',
  unknown: 'Məlumat azdır',
};

export const ALERT_TYPE_TEXT: Record<string, string> = {
  reserve: 'Ehtiyat avtobus',
  forecast: 'Proqnoz',
  bunching: 'Toplanma',
  traffic: 'Tıxac',
  bot: 'Saxta bildiriş',
};

export function since(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return 'indicə';
  if (m < 60) return `${m} dəq əvvəl`;
  return `${Math.floor(m / 60)} saat əvvəl`;
}
