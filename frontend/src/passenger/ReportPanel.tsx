// Sıxlığı bildir: bir toxunuş. Əvvəl kontekst (avtobusdayam / dayanacaqdayam), sonra səviyyə.
import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { ApiError, queueReport, sendReport, type ReportBody } from '../api';
import { CrowdGlyph } from '../components/Crowd';
import { getPosition } from '../lib/geo';
import type { Level } from '../api';

export interface ReportTarget {
  routeId: string;
  busId?: string;
  busLabel?: string;
  stopId: string;
  stopName: string;
}

const LEVELS: Array<{ level: Level; key: ReportBody['level']; bus: string; stop: string }> = [
  { level: 1, key: 'low', bus: 'Yer var', stop: 'Az adam var' },
  { level: 2, key: 'medium', bus: 'Ayaq üstə yer var', stop: 'Orta' },
  { level: 3, key: 'high', bus: 'Çox sıx', stop: 'Çox adam gözləyir' },
];

export function ReportPanel({ target, onDone }: { target: ReportTarget; onDone?: () => void }) {
  const [context, setContext] = useState<'bus' | 'stop'>(target.busId ? 'bus' : 'stop');
  const [busy, setBusy] = useState<Level | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(l: (typeof LEVELS)[number]) {
    setBusy(l.level);
    setResult(null);
    const pos = await getPosition(4000);
    const body: ReportBody = {
      context,
      level: l.key,
      routeId: target.routeId,
      ...(context === 'bus' && target.busId ? { busId: target.busId } : {}),
      ...(context === 'stop' ? { stopId: target.stopId } : {}),
      ...(pos ? { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy } : {}),
    };
    try {
      const r = await sendReport(body);
      setResult({ ok: true, text: r.message });
      onDone?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        queueReport(body);
        setResult({ ok: true, text: 'İnternet yoxdur. Bildiriş yadda saxlanıldı və bağlantı bərpa olanda göndəriləcək.' });
      } else setResult({ ok: false, text: e instanceof Error ? e.message : 'Göndərmək alınmadı' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="report">
      <div className="seg" role="radiogroup" aria-label="Harada olduğunuzu seçin">
        <button type="button" role="radio" aria-checked={context === 'bus'} className={context === 'bus' ? 'on' : ''} onClick={() => setContext('bus')} disabled={!target.busId}>
          {target.busLabel ? `${target.busLabel} avtobusundayam` : 'Avtobusdayam'}
        </button>
        <button type="button" role="radio" aria-checked={context === 'stop'} className={context === 'stop' ? 'on' : ''} onClick={() => setContext('stop')}>
          Dayanacaqda gözləyirəm
        </button>
      </div>
      <p className="report-q" id={`rq-${target.busId ?? target.stopId}`}>
        {context === 'bus' ? 'Avtobusun içində vəziyyət necədir?' : `${target.stopName} dayanacağında nə qədər adam gözləyir?`}
      </p>
      <div className="report-levels" role="group" aria-labelledby={`rq-${target.busId ?? target.stopId}`}>
        {LEVELS.map((l) => (
          <button key={l.key} type="button" className={`lvl-btn lvl-${l.level}`} onClick={() => submit(l)} disabled={busy != null}>
            {busy === l.level ? <Loader2 className="spin" size={18} aria-hidden /> : <CrowdGlyph level={l.level} size={18} />}
            <span>{context === 'bus' ? l.bus : l.stop}</span>
          </button>
        ))}
      </div>
      {result && (
        <p className={result.ok ? 'report-ok' : 'report-err'} role="status">
          {result.ok && <Check size={16} aria-hidden />} {result.text}
        </p>
      )}
      <p className="fine">Yer məlumatınız yalnız yoxlama üçün istifadə olunur və saxlanılmır. Avtobusa yaxın olduqca bildirişiniz daha çox nəzərə alınır.</p>
    </div>
  );
}
