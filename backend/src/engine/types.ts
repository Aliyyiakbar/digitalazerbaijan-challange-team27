export type Level = 1 | 2 | 3; // 1 aşağı, 2 orta, 3 yüksək
export const LEVEL_NAME: Record<Level, 'low' | 'medium' | 'high'> = { 1: 'low', 2: 'medium', 3: 'high' };
export const LEVEL_AZ: Record<Level, string> = { 1: 'aşağı', 2: 'orta', 3: 'yüksək' };

export type ReportContext = 'bus' | 'stop';

export interface CrowdReport {
  id: string;
  ts: number; // simulyasiya vaxtı (ms)
  routeId: string;
  busId: string | null;
  stopId: string | null;
  context: ReportContext;
  level: Level;
  deviceId: string;
  ip: string;
  hasGeo: boolean;
  distanceM: number | null;
  geoWeight: number;
  trust: number;
  quarantined: boolean;
  source: 'app' | 'sim' | 'bot';
}

export interface BusState {
  id: string;
  routeId: string;
  label: string;
  d: number; // dövrə boyunca məsafə (m)
  lat: number;
  lon: number;
  bearing: number;
  speed: number; // m/s, hamarlanmış
  lastTs: number;
  dwellingAt: string | null; // dayanacaq id (loop seq açarı) — dayanırsa
  dwellStart: number | null;
  reserve: boolean; // operator tərəfindən əlavə edilib
  addedAt: number;
}

export type Badge = 'confirmed' | 'check' | 'suspicious' | 'none';

export interface CrowdEstimate {
  score: number | null; // 1..3, hesablana bilmirsə null
  level: Level | null;
  confidence: number; // 0..1
  badge: Badge;
  n: number; // pəncərədəki bildiriş sayı (karantinsiz)
  devices: number;
  effN: number; // çəkili say
  reasons: string[]; // etibarı artıran/azaldan səbəblər (izah üçün)
}

export type Cause = 'normal' | 'demand' | 'traffic' | 'mixed' | 'unknown';
export type Congestion = 'RUNNING_SMOOTHLY' | 'STOP_AND_GO' | 'CONGESTION' | 'SEVERE_CONGESTION' | 'UNKNOWN_CONGESTION_LEVEL';

export type AlertType = 'reserve' | 'forecast' | 'bunching' | 'traffic' | 'bot';
export type AlertStatus = 'new' | 'ack' | 'resolved';

export interface Alert {
  id: string;
  type: AlertType;
  routeId: string | null;
  createdAt: number;
  status: AlertStatus;
  title: string;
  recommendation: string;
  confidence: number | null;
  badge: Badge;
  explanation: Record<string, unknown>;
  dispatchedBusId?: string | null;
}
