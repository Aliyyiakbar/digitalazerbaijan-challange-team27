// Leaflet xəritəsi. Xətt həndəsəsi OpenStreetMap/OSRM-dən; altlıq CARTO (açıq/tünd).
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet';
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
}
export interface MapBus {
  id: string;
  lat: number;
  lon: number;
  label: string;
  level: Level | null;
  ring?: boolean; // toplanma və s. üçün vurğu
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

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

function busIcon(b: MapBus) {
  const cls = ['bus-marker', `lvl-${b.level ?? 'none'}`, b.ring ? 'ring' : '', b.reserve ? 'reserve' : '', b.dim ? 'dim' : ''].join(' ');
  return L.divIcon({ className: 'bus-marker-wrap', html: `<span class="${cls}">${b.label}</span>`, iconSize: [0, 0] });
}

function Fit({ bounds, deps }: { bounds: L.LatLngBoundsExpression | null; deps: string }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  return null;
}

export function MapView({
  theme,
  lines,
  buses,
  stops,
  onStopClick,
  fitKey,
  label,
}: {
  theme: 'light' | 'dark';
  lines: MapLine[];
  buses: MapBus[];
  stops: MapStop[];
  onStopClick?: (id: string) => void;
  fitKey: string;
  label: string;
}) {
  const bounds = useMemo(() => {
    const pts = lines.flatMap((l) => l.coords);
    const all = pts.length ? pts : stops.map((s) => [s.lat, s.lon] as [number, number]);
    return all.length ? L.latLngBounds(all) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return (
    <div className={`map map-${theme}`} role="region" aria-label={label}>
      <MapContainer center={[40.395, 49.86]} zoom={12} scrollWheelZoom zoomControl={false} attributionControl preferCanvas={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILES[theme]} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' subdomains="abcd" />
        <Fit bounds={bounds} deps={fitKey} />
        {lines.map((l) => (
          <Polyline key={l.id} positions={l.coords} pathOptions={{ color: l.color, weight: l.weight ?? 4, opacity: l.opacity ?? 0.9, dashArray: l.dash, lineCap: 'round', lineJoin: 'round' }}>
            {l.label && <Tooltip sticky>{l.label}</Tooltip>}
          </Polyline>
        ))}
        {stops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={s.selected ? 8 : 5}
            pathOptions={{ className: s.selected ? 'stop-dot selected' : 'stop-dot' }}
            eventHandlers={onStopClick ? { click: () => onStopClick(s.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {s.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {buses.map((b) => (
          <Marker key={b.id} position={[b.lat, b.lon]} icon={busIcon(b)} keyboard={false} />
        ))}
      </MapContainer>
    </div>
  );
}
