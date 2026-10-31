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

/** İstifadəçinin yeri: icazə bir dəfə verilibsə, növbəti açılışda avtomatik izlənir. */
export function useUserLocation() {
  const [pos, setPos] = useState<Pos | null>(null);
  const [status, setStatus] = useState<LocStatus>('idle');
  const watch = useRef<number | null>(null);
  const start = useCallback(() => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setStatus('unavailable');
      return;
    }
    if (watch.current != null) return;
    setStatus('locating');
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setStatus('on');
        localStorage.setItem('stb.loc', 'on');
      },
      (e) => {
        setStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable');
        if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
    );
  }, []);
  useEffect(() => {
    if (localStorage.getItem('stb.loc') === 'on') start();
    return () => {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
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
