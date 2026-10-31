// @vitest-environment jsdom
// UI smoke testləri: real backend cavablarından götürülmüş fixture-lərlə hər ekran çökmədən
// render olunur, əsas mətnlər və əlçatanlıq atributları yerindədir.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import network from './fixtures/network.json';
import overview from './fixtures/overview.json';
import arrivals from './fixtures/arrivals.json';
import plan from './fixtures/plan.json';
import state from './fixtures/state.json';
import history from './fixtures/history.json';
import forecast from './fixtures/forecast.json';
import sim from './fixtures/sim.json';
import { PassengerApp } from '../src/passenger/PassengerApp';
import { OperatorApp } from '../src/operator/OperatorApp';

const posted: Array<{ url: string; body: unknown }> = [];

beforeAll(() => {
  const routes: Array<[RegExp, unknown]> = [
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
  it('dayanacaq, gəlişlər və ETA görünür', async () => {
    at('/', <PassengerApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Gənclik' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.arr').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/istiqamətində/).length).toBeGreaterThan(0);
    // naviqasiya və əlçatanlıq
    expect(screen.getByRole('navigation', { name: 'Bölmələr' })).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('avtobusu açıb sıxlığı bildirmək mümkündür', async () => {
    at('/', <PassengerApp />);
    await waitFor(() => expect(document.querySelectorAll('.arr-main').length).toBeGreaterThan(0));
    fireEvent.click(document.querySelector('.arr-main')!);
    const group = await screen.findByRole('group', { name: /vəziyyət necədir|nə qədər adam/ });
    fireEvent.click(within(group).getByRole('button', { name: /Çox sıx/ }));
    expect(await screen.findByText(/Təşəkkürlər/)).toBeTruthy();
    const rep = posted.find((p) => p.url.includes('/api/reports'));
    expect(rep?.body).toMatchObject({ context: 'bus', level: 'high' });
  });

  it('marşrut planı və xətlər bölmələri açılır', async () => {
    at('/', <PassengerApp />);
    fireEvent.click(await screen.findByRole('button', { name: /Marşrut/ }));
    expect(await screen.findByRole('heading', { name: 'Marşrut planı' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.journey').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Xətlər/ }));
    expect(await screen.findByRole('radiogroup', { name: 'Xətt seçin' })).toBeTruthy();
  });

  it('sadə rejim xəritəni gizlədir', async () => {
    localStorage.setItem('stb.prefs', JSON.stringify({ simple: true }));
    at('/', <PassengerApp />);
    await screen.findByRole('heading', { level: 1, name: 'Gənclik' });
    expect(document.querySelector('.p-map')).toBeNull();
    localStorage.removeItem('stb.prefs');
  });
});

describe('operator modulu', () => {
  it('panel: xəbərdarlıqlar, xəritə, xətlər cədvəli', async () => {
    at('/operator', <OperatorApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dispetçer paneli' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.rtable tbody tr').length).toBe(10));
    expect(screen.getByRole('heading', { name: 'Xəbərdarlıqlar' })).toBeTruthy();
    expect(document.querySelectorAll('.alert').length).toBeGreaterThan(0);
  });

  it('"Niyə?" izahı və xətt təfərrüatı açılır', async () => {
    at('/operator', <OperatorApp />);
    await waitFor(() => expect(document.querySelectorAll('.alert').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /Niyə\?/ })[0]);
    expect(document.querySelector('.evidence')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /təfərrüatı/ })[0]);
    expect(await screen.findByRole('heading', { name: /Sıxlıq dalğası/ })).toBeTruthy();
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
