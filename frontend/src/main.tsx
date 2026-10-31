import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '@fontsource-variable/public-sans';
import './styles/base.css';
import './styles/passenger.css';
import './styles/operator.css';
import './styles/mobile.css';
import { PassengerApp } from './passenger/PassengerApp';
import { OperatorApp } from './operator/OperatorApp';
import { MobileApp } from './mobile/MobileApp';

/** Telefondan əsas ünvana girən mobil tətbiqə keçir. Barmaqla idarə olunan dar ekran: cihaz adına baxılmır. */
function Desktop() {
  const { search, pathname } = useLocation();
  const params = new URLSearchParams(search);
  if (params.get('desktop') === '1') sessionStorage.setItem('stb.desktop', '1');
  const phone = window.matchMedia?.('(pointer: coarse) and (max-width: 899px)').matches && !sessionStorage.getItem('stb.desktop');
  if (phone) return <Navigate to={`/mobile${pathname === '/' ? '' : pathname}${search}`} replace />;
  return <PassengerApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/operator/*" element={<OperatorApp />} />
        <Route path="/mobile/*" element={<MobileApp />} />
        <Route path="*" element={<Desktop />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
