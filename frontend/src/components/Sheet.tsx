// Telefonda aşağıdan açılan panel (AYNA MaaS / xəritə tətbiqləri kimi), masaüstündə sol panel.
// Hərəkət: iOS drawer əyrisi, sürətli "fırlatma" ilə keçid (sürət > 0.11 px/ms), sərhəddə sürtünmə,
// sürükləmə zamanı pointer capture. Klaviatura: tutacaq düyməsi Enter/Space ilə açılıb-bağlanır.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type Snap = 'peek' | 'full';

export function useIsDesktop(): boolean {
  const q = '(min-width: 900px)';
  const [d, setD] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const h = () => setD(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return d;
}

export function Sheet({ snap, onSnap, children, label }: { snap: Snap; onSnap: (s: Snap) => void; children: ReactNode; label: string }) {
  const desktop = useIsDesktop();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; base: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);

  // panelin hündürlüyü 88vh; "peek" vəziyyətində yalnız aşağı 40vh görünür
  const offset = () => (snap === 'full' ? 0 : window.innerHeight * 0.48);

  function down(e: React.PointerEvent) {
    if (desktop || drag.current) return; // ikinci barmağa məhəl qoyma
    drag.current = { y: e.clientY, t: performance.now(), base: offset(), id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    let delta = e.clientY - d.y;
    const pos = d.base + delta;
    // sərhəddən kənarda sürtünmə
    if (pos < 0) delta = -d.base + pos * 0.25;
    if (pos > window.innerHeight * 0.62) delta = window.innerHeight * 0.62 - d.base + (pos - window.innerHeight * 0.62) * 0.25;
    setDy(delta);
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const delta = e.clientY - d.y;
    const v = delta / Math.max(1, performance.now() - d.t);
    setDy(0);
    if (Math.abs(delta) < 6) return; // toxunuş — handle düyməsi özü idarə edir
    if (v < -0.11 || delta < -80) onSnap('full');
    else if (v > 0.11 || delta > 80) onSnap('peek');
  }

  if (desktop)
    return (
      <aside className="sheet desktop" aria-label={label}>
        <div className="sheet-body">{children}</div>
      </aside>
    );

  const y = Math.max(-12, offset() + dy);
  return (
    <aside ref={ref} className={`sheet mobile ${dy ? 'dragging' : ''}`} style={{ transform: `translate3d(0, ${y}px, 0)` }} aria-label={label}>
      <div className="sheet-grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button type="button" className="grip" aria-label={snap === 'full' ? 'Paneli kiçilt' : 'Paneli genişləndir'} aria-expanded={snap === 'full'} onClick={() => onSnap(snap === 'full' ? 'peek' : 'full')} />
      </div>
      <div className="sheet-body">{children}</div>
    </aside>
  );
}
