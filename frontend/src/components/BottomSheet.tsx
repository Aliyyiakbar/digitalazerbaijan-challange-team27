// /mobile üçün üç vəziyyətli alt panel (xəritə tətbiqləri kimi): az, yarım, tam.
// Sürükləmə barmağı dərhal izləyir; buraxanda sürətə görə növbəti vəziyyətə keçir (iOS drawer əyrisi),
// sərhəddən kənarda sürtünmə var. Məzmun öz içində sürüşür, səhifəyə ötürülmür.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';
const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const PEEK_PX = 188;
const FLICK = 0.45; // px/ms: bundan sürətli hərəkət "fırlatma" sayılır

export function useStageHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(() => window.innerHeight || 700);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(() => setH(el.clientHeight || window.innerHeight));
    o.observe(el);
    setH(el.clientHeight || window.innerHeight);
    return () => o.disconnect();
  }, []);
  return { ref, height: h };
}

/** Vəziyyətə görə panelin görünən hündürlüyü (px). */
export function snapHeight(snap: SheetSnap, stage: number, top: number): number {
  const full = Math.max(PEEK_PX, stage - top);
  if (snap === 'full') return full;
  if (snap === 'half') return Math.min(full, Math.max(PEEK_PX + 60, Math.round(stage * 0.52)));
  return Math.min(full, PEEK_PX);
}

export function BottomSheet({ snap, onSnap, stage, top, children, label }: { snap: SheetSnap; onSnap: (s: SheetSnap) => void; stage: number; top: number; children: ReactNode; label: string }) {
  const drag = useRef<{ y: number; t: number; lastY: number; lastT: number; v: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  const full = snapHeight('full', stage, top);
  const visible = snapHeight(snap, stage, top);

  function down(e: React.PointerEvent) {
    if (drag.current) return; // ikinci barmağa məhəl qoyma
    drag.current = { y: e.clientY, t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0, id: e.pointerId };
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    if (now > d.lastT) d.v = (e.clientY - d.lastY) / (now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
    let delta = e.clientY - d.y;
    if (Math.abs(delta) > 4) moved.current = true;
    const h = visible - delta;
    // sərhəddən kənarda sürtünmə
    if (h > full) delta = visible - full - (h - full) * 0.2;
    const min = snapHeight('peek', stage, top);
    if (h < min) delta = visible - min + (min - h) * 0.2;
    setDy(delta);
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    const delta = e.clientY - d.y;
    setDy(0);
    if (!moved.current) return;
    const h = visible - delta;
    const i = ORDER.indexOf(snap);
    let next: SheetSnap;
    if (d.v < -FLICK) next = ORDER[Math.min(i + 1, 2)];
    else if (d.v > FLICK) next = ORDER[Math.max(i - 1, 0)];
    else next = ORDER.reduce((a, b) => (Math.abs(snapHeight(b, stage, top) - h) < Math.abs(snapHeight(a, stage, top) - h) ? b : a));
    onSnap(next);
  }

  const y = full - visible + dy;
  return (
    <aside className={`m-sheet ${dragging ? 'dragging' : ''}`} style={{ height: full, transform: `translate3d(0, ${y}px, 0)` }} aria-label={label}>
      <div className="m-grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button
          type="button"
          className="m-grip-btn"
          aria-label={snap === 'full' ? 'Paneli kiçilt' : 'Paneli genişləndir'}
          aria-expanded={snap === 'full'}
          onClick={() => {
            if (!moved.current) onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
          }}
        />
      </div>
      <div className="m-sheet-body" style={{ height: Math.max(0, visible - 28) }}>
        {children}
      </div>
    </aside>
  );
}
