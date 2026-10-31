import { useCallback, useEffect, useRef, useState } from 'react';

export interface Pos {
  lat: number;
  lon: number;
  accuracy: number;
}

/** Brauzerin yer məlumatı. Yalnız HTTPS və ya localhost-da işləyir; icazə verilməsə null. */
export function getPosition(timeoutMs = 6000): Promise<Pos | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}


export type LocStatus = 'idle' | 'locating' | 'on' | 'denied' | 'unavailable';

export function locationStatusMessage(status: LocStatus): string | null {
  if (status === 'denied') return 'İcazə verilmədi';
  if (status === 'unavailable') return 'Yer tapılmadı — yenidən cəhd et';
  return null;
}

export function locationControlLabel(status: LocStatus): string {
  return locationStatusMessage(status) ?? (status === 'locating' ? 'Axtarılır…' : 'Yerimi göstər');
}

/** İcazə əvvəl verilibsə, növbəti açılışda məkanı yenidən alır. */
export function useUserLocation() {
  const [pos, setPos] = useState<Pos | null>(null);
  const [status, setStatus] = useState<LocStatus>('idle');
  const requestId = useRef(0);
  const activeRequest = useRef<number | null>(null);
  const watchdog = useRef<number | null>(null);
  const start = useCallback(() => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setStatus('unavailable');
      return;
    }
    if (activeRequest.current !== null) return;
    const id = ++requestId.current;
    activeRequest.current = id;
    setStatus('locating');
    const finish = (next: LocStatus) => {
      if (activeRequest.current !== id) return;
      if (watchdog.current !== null) window.clearTimeout(watchdog.current);
      watchdog.current = null;
      activeRequest.current = null;
      setStatus(next);
    };
    watchdog.current = window.setTimeout(() => finish('unavailable'), 10_000);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (activeRequest.current !== id) return;
          setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
          try {
            localStorage.setItem('stb.loc', 'on');
          } catch {}
          finish('on');
        },
        (e) => finish(e.code === 1 ? 'denied' : 'unavailable'),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    } catch {
      finish('unavailable');
    }
  }, []);
  useEffect(() => {
    if (localStorage.getItem('stb.loc') === 'on') start();
    return () => {
      if (watchdog.current !== null) window.clearTimeout(watchdog.current);
      watchdog.current = null;
      activeRequest.current = null;
      requestId.current += 1;
    };
  }, [start]);
  return { pos, status, start };
}

export function walkMin(m: number): string {
  return `${Math.max(1, Math.round(m / 75))} dəq piyada`;
}
export function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
