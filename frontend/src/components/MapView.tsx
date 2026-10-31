// Leaflet xəritəsi. Altlıq: OpenStreetMap plitələri (açarsız). Xətlər: opendata.az (AYNA).
// Canvas renderer — 60+ xətt və 500+ avtobus üçün yüngül.
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Circle, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Level } from '../api';

export interface MapLine {
  id: string;
  coords: [number, number][];
  color: string;
  weight?: number;
  opacity?: number;
  dash?: string;
  label?: string;
  onClick?: () => void;
}
export interface MapBus {
  id: string;
  lat: number;
  lon: number;
  label: string;
  level: Level | null;
  color?: string;
  ring?: boolean;
  reserve?: boolean;
  dim?: boolean;
}
export interface MapStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  selected?: boolean;
}
export interface UserPos {
  lat: number;
  lon: number;
  accuracy: number;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const canvas = L.canvas({ padding: 0.4 });

function busIcon(b: MapBus) {
  const cls = ['bus-marker', `lvl-${b.level ?? 'none'}`, b.label ? 'labeled' : '', b.ring ? 'ring' : '', b.reserve ? 'reserve' : '', b.dim ? 'dim' : ''].join(' ');
  const style = b.color ? ` style="--route:${b.color}"` : '';
  return L.divIcon({ className: 'bus-marker-wrap', html: `<span class="${cls}"${style}>${b.label}</span>`, iconSize: [0, 0] });
}

const userIcon = L.divIcon({ className: 'bus-marker-wrap', html: '<span class="user-dot" aria-hidden="true"></span>', iconSize: [0, 0] });

export interface FitRequest {
  key: string;
  points: [number, number][];
}

function Fit({ fit, pad }: { fit: FitRequest | null; pad: { tl: [number, number]; br: [number, number] } }) {
  const map = useMap();
  useEffect(() => {
    if (!fit || !fit.points.length) return;
    const b = L.latLngBounds(fit.points);
    if (fit.points.length === 1 || b.getNorthEast().distanceTo(b.getSouthWest()) < 200) map.flyTo(b.getCenter(), 16, { duration: 0.6 });
    else map.flyToBounds(b, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, maxZoom: 16, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key]);
  return null;
}

function ClickAway({ onClick }: { onClick?: () => void }) {
  useMapEvents({ click: () => onClick?.() });
  return null;
}

export function MapView({
  theme,
  background,
  lines,
  buses,
  stops,
  user,
  onStopClick,
  onMapClick,
  fit,
  pad = { tl: [24, 24], br: [24, 24] },
  label,
}: {
  theme: 'light' | 'dark';
  background?: MapLine[];
  lines: MapLine[];
  buses: MapBus[];
  stops: MapStop[];
  user?: UserPos | null;
  onStopClick?: (id: string) => void;
  onMapClick?: () => void;
  fit: FitRequest | null;
  pad?: { tl: [number, number]; br: [number, number] };
  label: string;
}) {
  const bg = useMemo(() => background ?? [], [background]);
  return (
    <div className={`map map-${theme}`} role="region" aria-label={label}>
      <MapContainer center={[40.405, 49.87]} zoom={12} scrollWheelZoom zoomControl={false} attributionControl preferCanvas renderer={canvas} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE_URL} maxZoom={19} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · xətlər: <a href="https://opendata.az">opendata.az</a>' />
        <Fit fit={fit} pad={pad} />
        <ClickAway onClick={onMapClick} />
        {bg.map((l) => (
          <Polyline key={`bg-${l.id}`} positions={l.coords} pathOptions={{ color: l.color, weight: l.weight ?? 1.5, opacity: l.opacity ?? 0.35, interactive: false }} />
        ))}
        {lines.map((l) => (
          <Polyline
            key={l.id}
            positions={l.coords}
            pathOptions={{ color: l.color, weight: l.weight ?? 4, opacity: l.opacity ?? 0.9, dashArray: l.dash, lineCap: 'round', lineJoin: 'round' }}
            eventHandlers={l.onClick ? { click: (e) => (L.DomEvent.stopPropagation(e), l.onClick!()) } : undefined}
          >
            {l.label && <Tooltip sticky>{l.label}</Tooltip>}
          </Polyline>
        ))}
        {stops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={s.selected ? 8 : 4.5}
            pathOptions={{ color: s.selected ? '#ffffff' : '#1a1a1a', weight: s.selected ? 3 : 1.5, fillColor: s.selected ? '#1a1a1a' : '#ffffff', fillOpacity: 1 }}
            eventHandlers={onStopClick ? { click: (e) => (L.DomEvent.stopPropagation(e), onStopClick(s.id)) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {s.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {buses.map((b) => (
          <Marker key={b.id} position={[b.lat, b.lon]} icon={busIcon(b)} keyboard={false} interactive={false} />
        ))}
        {user && (
          <>
            <Circle center={[user.lat, user.lon]} radius={Math.min(user.accuracy, 1500)} pathOptions={{ color: '#1d6ff2', weight: 1, fillColor: '#1d6ff2', fillOpacity: 0.12, interactive: false }} />
            <Marker position={[user.lat, user.lon]} icon={userIcon} keyboard={false} interactive={false} zIndexOffset={1000} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
