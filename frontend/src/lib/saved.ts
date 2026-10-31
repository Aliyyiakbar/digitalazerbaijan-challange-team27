// Seçilmiş dayanacaq və xətlər, son baxılan dayanacaqlar. Qeydiyyat yoxdur: cihazda saxlanılır.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'stb.saved';
const EVENT = 'stb-saved';
const MAX_RECENT = 6;

export interface Saved {
  stops: string[];
  routes: string[];
  recents: string[];
}

function read(): Saved {
  try {
    return { stops: [], routes: [], recents: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { stops: [], routes: [], recents: [] };
  }
}

function write(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* yaddaş bağlı ola bilər (məxfi rejim): seçim yalnız bu səhifədə qalır */
  }
  window.dispatchEvent(new Event(EVENT));
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]);

export function useSaved() {
  const [saved, setSaved] = useState<Saved>(read);
  useEffect(() => {
    const h = () => setSaved(read());
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  const toggleStop = useCallback((id: string) => {
    const s = read();
    write({ ...s, stops: toggle(s.stops, id) });
  }, []);
  const toggleRoute = useCallback((id: string) => {
    const s = read();
    write({ ...s, routes: toggle(s.routes, id) });
  }, []);
  const pushRecent = useCallback((id: string) => {
    const s = read();
    if (s.recents[0] !== id) write({ ...s, recents: [id, ...s.recents.filter((x) => x !== id)].slice(0, MAX_RECENT) });
  }, []);
  return { saved, toggleStop, toggleRoute, pushRecent };
}
