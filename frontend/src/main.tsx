import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/public-sans';
import './styles/base.css';
import './styles/passenger.css';
import './styles/operator.css';
import { PassengerApp } from './passenger/PassengerApp';
import { OperatorApp } from './operator/OperatorApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/operator/*" element={<OperatorApp />} />
        <Route path="*" element={<PassengerApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
