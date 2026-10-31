// @vitest-environment jsdom
// UI smoke testləri: real backend cavablarından götürülmüş fixture-lərlə hər ekran çökmədən
// render olunur, əsas mətnlər və əlçatanlıq atributları yerindədir.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import network from './fixtures/network.json';
import background from './fixtures/background.json';
import overview from './fixtures/overview.json';
import arrivals from './fixtures/arrivals.json';
import plan from './fixtures/plan.json';
import state from './fixtures/state.json';
import history from './fixtures/history.json';
import forecast from './fixtures/forecast.json';
import sim from './fixtures/sim.json';
import { PassengerApp } from '../src/passenger/PassengerApp';
import { OperatorApp } from '../src/operator/OperatorApp';
import { MobileApp } from '../src/mobile/MobileApp';

const posted: Array<{ url: string; body: unknown }> = [];

beforeAll(() => {
  const routes: Array<[RegExp, unknown]> = [
    [/\/api\/network\/background/, background],
    [/\/api\/network/, network],
    [/\/api\/operator\/overview/, overview],
    [/\/api\/stops\/.+\/arrivals/, arrivals],
    [/\/api\/plan/, plan],
    [/\/api\/state/, state],
    [/\/api\/operator\/history/, history],
    [/\/api\/operator\/forecast/, forecast],
    [/\/api\/sim\/state/, sim],
    [/\/api\/session/, { deviceId: '00000000-0000-4000-8000-000000000000', token: 't' }],
    [/\/api\/reports/, { message: 'Təşəkkürlər! Bildirişiniz tam çəki ilə qəbul edildi.', report: { id: 'x', geoWeight: 1, trust: 0.5, distanceM: 10 } }],
    [/\/api\/operator\/dispatch/, { ok: true, busId: 'M6-R1', atStop: 'Gənclik' }],
  ];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posted.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
    const hit = routes.find(([re]) => re.test(url));
    return new Response(JSON.stringify(hit ? hit[1] : { error: 'yoxdur' }), { status: hit ? 200 : 404, headers: { 'content-type': 'application/json' } });
  });
  class FakeWS {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: 'state', data: state }) });
      }, 0);
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeWS);
  // jsdom-da canvas yoxdur: Leaflet-in canvas renderer-i üçün heç nə etməyən 2D kontekst
  const noop = () => {};
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'measureText' ? () => ({ width: 0 }) : noop) });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // Leaflet jsdom-da ölçü tələb edir
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(cleanup);

function at(path: string, el: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/operator/*" element={el} />
        <Route path="*" element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('sərnişin modulu', () => {
  it('ana səhifə: axtarış, "Haraya gedirsiniz?", dayanacaqlar və xətlər', async () => {
    localStorage.clear();
    at('/', <PassengerApp />);
    expect(await screen.findByRole('button', { name: /Haraya gedirsiniz/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /dayanacaqlar/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Dayanacaq və ya xətt axtar/ }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.route-tile').length).toBeGreaterThan(50);
    expect(screen.getByRole('button', { name: 'Yerimi göstər' })).toBeTruthy();
  });

  it('dayanacaq → gələn avtobuslar → sıxlığı bildir', async () => {
    localStorage.clear();
    at('/', <PassengerApp />);
    await waitFor(() => expect(document.querySelector('.stop-list button')).toBeTruthy());
    fireEvent.click(document.querySelector('.stop-list button')!);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.arr-row').length).toBeGreaterThan(0));
    fireEvent.click(document.querySelector('.arr-row')!);
    const group = await screen.findByRole('group', { name: /vəziyyət necədir|nə qədər adam/ });
    fireEvent.click(within(group).getByRole('button', { name: /Çox sıx/ }));
    expect(await screen.findByText(/Təşəkkürlər/)).toBeTruthy();
    expect(posted.find((p) => p.url.includes('/api/reports'))?.body).toMatchObject({ context: 'bus', level: 'high' });
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('xətt: dayanacaqlar zaman xətti; planlayıcı və axtarış açılır', async () => {
    localStorage.clear();
    at('/', <PassengerApp />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^14:/ }))[0]);
    await waitFor(() => expect(document.querySelectorAll('.timeline li').length).toBeGreaterThan(5));
    fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
    fireEvent.click(await screen.findByRole('button', { name: /Haraya gedirsiniz/ }));
    expect(await screen.findByRole('heading', { name: 'Marşrut planı' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Dayanacaq və ya xətt axtar/ }))[0]);
    fireEvent.change(await screen.findByPlaceholderText(/Dayanacaq və ya xətt/), { target: { value: 'metro' } });
    await waitFor(() => expect(document.querySelectorAll('.result-list li').length).toBeGreaterThan(0));
  });

  it('sadə rejim xəritəni gizlədir', async () => {
    localStorage.clear();
    localStorage.setItem('stb.prefs', JSON.stringify({ simple: true }));
    at('/', <PassengerApp />);
    await screen.findByRole('button', { name: /Haraya gedirsiniz/ });
    expect(document.querySelector('.p-map')).toBeNull();
    localStorage.clear();
  });
});

describe('mobil tətbiq (/mobile)', () => {
  it('aşağı bölmələr: xəritə, marşrut, xətlər, seçilmişlər', async () => {
    localStorage.clear();
    at('/mobile', <MobileApp />);
    const nav = await screen.findByRole('navigation', { name: 'Bölmələr' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Xəritə', 'Marşrut', 'Xətlər', 'Seçilmişlər']);
    expect(await screen.findByRole('button', { name: /Haraya gedirsiniz/ })).toBeTruthy();
    expect(document.querySelector('.route-tile')).toBeNull(); // ana paneldə xətt şəbəkəsi yoxdur
    fireEvent.click(within(nav).getByRole('button', { name: 'Xətlər' }));
    expect(await screen.findByRole('heading', { name: 'Xətlər' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.line-list li').length).toBeGreaterThan(50));
    fireEvent.click(within(nav).getByRole('button', { name: 'Seçilmişlər' }));
    expect(await screen.findByText(/ulduza toxunun/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Sadə rejim/ })).toBeTruthy();
  });

  it('xətt: gediş və qayıdış ayrı dayanacaqlar göstərir, seçim saxlanılır', async () => {
    localStorage.clear();
    at('/mobile/route/14', <MobileApp />);
    const dirs = await screen.findByRole('radiogroup', { name: 'İstiqamət' });
    const count = () => document.querySelectorAll('.timeline li').length;
    await waitFor(() => expect(count()).toBeGreaterThan(5));
    const first = document.querySelector('.tl-name')!.textContent;
    fireEvent.click(within(dirs).getByRole('radio', { name: /Qayıdış/ }));
    await waitFor(() => expect(document.querySelector('.tl-name')!.textContent).not.toBe(first));
    expect(within(dirs).getByRole('radio', { name: /Qayıdış/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: 'Seçilmişlərə əlavə et' })[0]);
    expect(JSON.parse(localStorage.getItem('stb.saved')!).routes).toEqual(['14']);
    localStorage.clear();
  });

  it('panel sürüklənir və düymə ilə də vəziyyət dəyişir', async () => {
    localStorage.clear();
    at('/mobile', <MobileApp />);
    const grip = await screen.findByRole('button', { name: 'Paneli genişləndir' });
    const body = document.querySelector('.m-sheet-body') as HTMLElement;
    const peek = parseInt(body.style.height, 10);
    fireEvent.click(grip);
    await waitFor(() => expect(parseInt(body.style.height, 10)).toBeGreaterThan(peek));
  });
});

describe('kompüter versiyası', () => {
  it('xətlər bölməsi süzür, "/" axtarışı açır, Esc geri qaytarır', async () => {
    localStorage.clear();
    at('/lines', <PassengerApp />);
    fireEvent.change(await screen.findByPlaceholderText(/Nömrə və ya dayanacaq/), { target: { value: '14' } });
    await waitFor(() => expect(document.querySelectorAll('.line-list li').length).toBeLessThan(20));
    expect(document.querySelector('.line-list')!.textContent).toContain('14');
    fireEvent.click(screen.getByRole('radio', { name: 'Seçilmiş' }));
    fireEvent.keyDown(window, { key: '/' });
    expect(await screen.findByPlaceholderText(/Dayanacaq və ya xətt nömrəsi/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText(/Dayanacaq və ya xətt nömrəsi/)).toBeNull());
  });

  it('birbaşa keçid: dayanacaq və xətt ünvandan açılır, naməlum ünvan ana səhifəyə qayıdır', async () => {
    localStorage.clear();
    const stop = (network as { stops: Array<{ id: string; name: string }> }).stops[0];
    at(`/stop/${stop.id}`, <PassengerApp />);
    expect(await screen.findByRole('heading', { level: 1, name: stop.name })).toBeTruthy();
    cleanup();
    at('/route/YOXDUR', <PassengerApp />);
    expect(await screen.findByRole('button', { name: /Haraya gedirsiniz/ })).toBeTruthy();
  });
});

describe('operator modulu', () => {
  it('panel: xəbərdarlıqlar, xəritə, xətlər cədvəli', async () => {
    at('/operator', <OperatorApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dispetçer paneli' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.rtable')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /Hamısı \d+/ }));
    await waitFor(() => expect(document.querySelectorAll('.rtable tbody tr').length).toBeGreaterThan(50));
    expect(screen.getByText('Yüksək sıxlıqda')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Xəbərdarlıqlar' })).toBeTruthy();
    expect(document.querySelectorAll('.alert').length).toBeGreaterThan(0);
  });

  it('"Niyə?" izahı və xətt təfərrüatı açılır', async () => {
    at('/operator', <OperatorApp />);
    await waitFor(() => expect(document.querySelectorAll('.alert').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /Niyə\?/ })[0]);
    expect(document.querySelector('.evidence')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Hamısı \d+/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /təfərrüatı/ })[0]);
    expect(await screen.findByRole('heading', { name: /Sıxlıq dalğası/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Real gediş statistikası' })).toBeTruthy();
    expect(document.querySelectorAll('.rchart .bar').length).toBeGreaterThan(30);
    expect(document.querySelectorAll('.ripple tbody tr').length).toBeGreaterThan(0);
  });

  it('vaxt maşını və demo paneli', async () => {
    at('/operator/history', <OperatorApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Vaxt maşını' })).toBeTruthy();
    cleanup();
    at('/operator/demo', <OperatorApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Simulyasiya və demo' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Başlat|Yenidən başlat/ }).length).toBe(5);
  });
});
