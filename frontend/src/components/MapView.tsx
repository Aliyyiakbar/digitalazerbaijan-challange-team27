// Leaflet xəritəsi. Altlıq: OpenStreetMap plitələri (açarsız). Xətlər: opendata.az (AYNA).
// Canvas renderer — 60+ xətt və 500+ avtobus üçün yüngül. Yalnız nömrəli avtobuslar və oxlar DOM-dadır.
import { memo, useEffect, useMemo } from 'react';
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
export interface MapArrow {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
}
export interface UserPos {
  lat: number;
  lon: number;
  accuracy: number;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const canvas = L.canvas({ padding: 0.4 });

// Eyni görünüşlü avtobus üçün eyni ikon: hər canlı yenilənmədə DOM yenidən qurulmur
const icons = new Map<string, L.DivIcon>();
function busIcon(b: MapBus) {
  const cls = ['bus-marker', `lvl-${b.level ?? 'none'}`, 'labeled', b.ring ? 'ring' : '', b.reserve ? 'reserve' : '', b.dim ? 'dim' : ''].join(' ');
  const key = `${cls}|${b.label}|${b.color ?? ''}`;
  let icon = icons.get(key);
  if (!icon) {
    const style = b.color ? ` style="--route:${b.color}"` : '';
    icon = L.divIcon({ className: 'bus-marker-wrap', html: `<span class="${cls}"${style}>${b.label}</span>`, iconSize: [0, 0] });
    icons.set(key, icon);
  }
  return icon;
}

const arrowIcons = new Map<string, L.DivIcon>();
function arrowIcon(bearing: number, color: string) {
  const angle = Math.round(bearing / 10) * 10;
  const key = `${angle}|${color}`;
  let icon = arrowIcons.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'bus-marker-wrap',
      html: `<span class="dir-arrow" style="transform:translate(-50%,-50%) rotate(${angle}deg);--route:${color}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 9.5 7 4l4.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`,
      iconSize: [0, 0],
    });
    arrowIcons.set(key, icon);
  }
  return icon;
}

const userIcon = L.divIcon({ className: 'bus-marker-wrap', html: '<span class="user-dot" aria-hidden="true"></span>', iconSize: [0, 0] });

export interface FitRequest {
  key: string;
  points: [number, number][];
}

function Fit({ fit, pad }: { fit: FitRequest | null; pad: { tl: [number, number]; br: [number, number] } }) {
  const map = useMap();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  useEffect(() => {
    if (!fit || !fit.points.length) return;
    const b = L.latLngBounds(fit.points);
    if (fit.points.length === 1 || b.getNorthEast().distanceTo(b.getSouthWest()) < 200) {
      const zoom = 16;
      // panel xəritəni örtür: nöqtə görünən hissənin ortasına düşsün
      const offset = L.point((pad.br[0] - pad.tl[0]) / 2, (pad.br[1] - pad.tl[1]) / 2);
      const center = map.unproject(map.project(b.getCenter(), zoom).add(offset), zoom);
      if (reduce) map.setView(center, zoom);
      else map.flyTo(center, zoom, { duration: 0.6 });
    } else map.flyToBounds(b, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, maxZoom: 16, duration: reduce ? 0 : 0.6, animate: !reduce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key]);
  return null;
}

/** Panel ölçüsü dəyişəndə (cihaz fırlananda, klaviatura açılanda) Leaflet yenidən ölçsün. */
function Resize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(() => map.invalidateSize());
    o.observe(el);
    return () => o.disconnect();
  }, [map]);
  return null;
}

function ClickAway({ onClick }: { onClick?: () => void }) {
  useMapEvents({ click: () => onClick?.() });
  return null;
}

const Background = memo(function Background({ lines }: { lines: MapLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <Polyline key={`bg-${l.id}`} positions={l.coords} interactive={false} pathOptions={{ color: l.color, weight: l.weight ?? 1.5, opacity: l.opacity ?? 0.35 }} />
      ))}
    </>
  );
});

export function MapView({
  theme,
  background,
  lines,
  buses,
  stops,
  arrows,
  arrowColor,
  user,
  onStopClick,
  onMapClick,
  fit,
  pad = { tl: [24, 24], br: [24, 24] },
  label,
  zoomControl = false,
}: {
  theme: 'light' | 'dark';
  background?: MapLine[];
  lines: MapLine[];
  buses: MapBus[];
  stops: MapStop[];
  arrows?: MapArrow[];
  arrowColor?: string;
  user?: UserPos | null;
  onStopClick?: (id: string) => void;
  onMapClick?: () => void;
  fit: FitRequest | null;
  pad?: { tl: [number, number]; br: [number, number] };
  label: string;
  zoomControl?: boolean;
}) {
  const bg = useMemo(() => background ?? [], [background]);
  return (
    <div className={`map map-${theme}`} role="region" aria-label={label}>
      <MapContainer center={[40.405, 49.87]} zoom={12} scrollWheelZoom zoomControl={false} attributionControl preferCanvas renderer={canvas} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE_URL} maxZoom={19} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · xətlər: <a href="https://opendata.az">opendata.az</a>' />
        <Fit fit={fit} pad={pad} />
        <Resize />
        <ClickAway onClick={onMapClick} />
        {zoomControl && <ZoomButtons />}
        <Background lines={bg} />
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
        {(arrows ?? []).map((a) => (
          <Marker key={a.id} position={[a.lat, a.lon]} icon={arrowIcon(a.bearing, arrowColor ?? '#0f1419')} keyboard={false} interactive={false} />
        ))}
        {buses.map((b) =>
          b.label ? (
            <Marker key={b.id} position={[b.lat, b.lon]} icon={busIcon(b)} keyboard={false} interactive={false} />
          ) : (
            <CircleMarker
              key={b.id}
              center={[b.lat, b.lon]}
              radius={b.ring ? 5 : 3.5}
              interactive={false}
              pathOptions={{ color: '#ffffff', weight: b.reserve ? 2.5 : 1, dashArray: b.ring ? '2 2' : undefined, fillColor: b.color ?? '#5b6573', fillOpacity: b.dim ? 0.25 : 0.95, opacity: b.dim ? 0.25 : 1 }}
            />
          ),
        )}
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

function ZoomButtons() {
  const map = useMap();
  useEffect(() => {
    const c = L.control.zoom({ position: 'bottomright', zoomInTitle: 'Yaxınlaşdır', zoomOutTitle: 'Uzaqlaşdır' });
    c.addTo(map);
    return () => {
      c.remove();
    };
  }, [map]);
  return null;
}
