// Sıxlıq və etibar göstəriciləri. Səviyyə YALNIZ rənglə verilmir:
// sütunların sayı (1/2/3) və mətn də eyni məlumatı daşıyır (WCAG 1.4.1).
import type { Badge, Level } from '../api';
import { BADGE_TEXT, LEVEL_TEXT } from '../lib/format';

export function CrowdGlyph({ level, size = 14 }: { level: Level | null; size?: number }) {
  const h = size;
  const w = Math.round(size * 1.1);
  const bw = w / 4.2;
  return (
    <svg className="crowd-glyph" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {[0, 1, 2].map((i) => {
        const bh = (h * (i + 1)) / 3;
        const on = level != null && i < level;
        return <rect key={i} x={i * (bw + bw / 2.4)} y={h - bh} width={bw} height={bh} rx={1} className={on ? 'on' : 'off'} />;
      })}
    </svg>
  );
}

export function CrowdPill({ level, compact = false }: { level: Level | null; compact?: boolean }) {
  if (level == null)
    return (
      <span className="crowd-pill lvl-none">
        <CrowdGlyph level={null} />
        {!compact && <span>Məlumat yoxdur</span>}
      </span>
    );
  return (
    <span className={`crowd-pill lvl-${level}`} title={LEVEL_TEXT[level].long}>
      <CrowdGlyph level={level} />
      <span className={compact ? 'sr-only' : undefined}>{LEVEL_TEXT[level].label}</span>
    </span>
  );
}

/** Etibar nişanı: forma + mətn. Dolu dairə = təsdiqlənib, yarım = yoxlanılmalı, boş = şübhəli. */
export function TrustMark({ badge, confidence, showText = true }: { badge: Badge; confidence?: number; showText?: boolean }) {
  const title = confidence != null && badge !== 'none' ? `Etibar ${Math.round(confidence * 100)}%` : BADGE_TEXT[badge];
  return (
    <span className={`trust trust-${badge}`} title={title}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" className="ring" />
        {badge === 'confirmed' && <circle cx="6" cy="6" r="4.5" className="fill" />}
        {badge === 'check' && <path d="M6 1.5 A4.5 4.5 0 0 1 6 10.5 Z" className="fill" />}
        {badge === 'suspicious' && <path d="M3.2 3.2 L8.8 8.8" className="slash" />}
      </svg>
      {showText ? <span>{BADGE_TEXT[badge]}</span> : <span className="sr-only">{BADGE_TEXT[badge]}</span>}
    </span>
  );
}

export function RouteBadge({ id, color, size = 'md' }: { id: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`route-badge rb-${size}`} style={{ background: color }} aria-label={`${id} nömrəli xətt`}>
      {id}
    </span>
  );
}
