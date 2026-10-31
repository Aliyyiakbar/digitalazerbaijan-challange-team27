// GTFS (statik) və GTFS-Realtime ixracı.
// Məqsəd: sıxlıq məlumatını beynəlxalq standartda vermək ki, AYNA MaaS, Google Maps və digər
// tətbiqlər onu birbaşa oxuya bilsin. GTFS-RT Protocol Buffers formatındadır (gtfs.org).
import JSZip from 'jszip';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { Engine } from '../engine/engine.js';
import { etaSeconds, effectiveSpeed } from '../engine/eta.js';

const rt = GtfsRealtimeBindings.transit_realtime;
const OCC = rt.VehiclePosition.OccupancyStatus;
const CONG = rt.VehiclePosition.CongestionLevel;

/** Bizim səviyyələrin GTFS-RT OccupancyStatus-a uyğunlaşdırılması. */
export function occupancyFor(level: number | null, confidence: number): number {
  if (level == null || confidence < 0.35) return OCC.NO_DATA_AVAILABLE;
  return level === 1 ? OCC.MANY_SEATS_AVAILABLE : level === 2 ? OCC.STANDING_ROOM_ONLY : OCC.CRUSHED_STANDING_ROOM_ONLY;
}

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';
}

function hms(sec: number): string {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export async function staticZip(engine: Engine): Promise<Buffer> {
  const net = engine.net;
  const zip = new JSZip();
  zip.file('agency.txt', csv([['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'], ['AYNA', 'Azərbaycan Yerüstü Nəqliyyat Agentliyi (demo məlumat)', 'https://ayna.gov.az', 'Asia/Baku', 'az']]));
  zip.file('stops.txt', csv([['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], ...[...net.stops.values()].map((s) => [s.id, s.name, s.lat, s.lon])]));
  zip.file('routes.txt', csv([['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], ...[...net.routes.values()].map((r) => [r.id, 'AYNA', r.id, r.name, 3, r.color.replace('#', '')])]));
  zip.file('calendar.txt', csv([['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], ['DAILY', 1, 1, 1, 1, 1, 1, 1, '20260801', '20261231']]));
  const shapes: Array<Array<string | number>> = [['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence']];
  const trips: Array<Array<string | number>> = [['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id']];
  const stopTimes: Array<Array<string | number>> = [['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint']];
  const freq: Array<Array<string | number>> = [['trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times']];
  for (const r of net.routes.values()) {
    for (const dir of [0, 1] as const) {
      const pts = dir === 0 ? r.forward : r.backward;
      const shapeId = `${r.id}_${dir}`;
      pts.forEach(([lat, lon], i) => shapes.push([shapeId, lat, lon, i]));
      const tripId = `${r.id}_${dir}_T`;
      const lst = r.loopStops.filter((s) => s.dir === dir || (dir === 0 && s.seq === 0));
      const headsign = lst[0]?.towards ?? '';
      trips.push([r.id, 'DAILY', tripId, headsign, dir, shapeId]);
      const base = dir === 0 ? 0 : r.forwardLength;
      const ordered = r.loopStops.filter((s) => (dir === 0 ? s.d <= r.forwardLength + 1 : s.d >= r.forwardLength - 1)).sort((a, b) => a.d - b.d);
      ordered.forEach((s, i) => {
        const t = (s.d - base) / 7 + i * 22;
        stopTimes.push([tripId, hms(t), hms(t + 20), s.stopId, i + 1, 0]);
      });
      freq.push([tripId, '06:00:00', '24:00:00', r.headwayMin * 60, 0]);
    }
  }
  zip.file('shapes.txt', csv(shapes));
  zip.file('trips.txt', csv(trips));
  zip.file('stop_times.txt', csv(stopTimes));
  zip.file('frequencies.txt', csv(freq));
  zip.file('feed_info.txt', csv([['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_version'], ['Smart Transit Baku (hackathon prototipi)', 'https://ayna.gov.az', 'az', '2026.10']]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function header(engine: Engine) {
  return { gtfsRealtimeVersion: '2.0', incrementality: rt.FeedHeader.Incrementality.FULL_DATASET, timestamp: Math.floor(engine.clock.now() / 1000) };
}

export function vehiclePositions(engine: Engine) {
  const ov = engine.liveState();
  const routeCong = new Map(ov.routes.map((r) => [r.id, r.cause.congestion]));
  const msg = rt.FeedMessage.fromObject({
    header: header(engine),
    entity: ov.buses.map((b) => ({
      id: b.id,
      vehicle: {
        trip: { tripId: `${b.routeId}_${b.dir}_T`, routeId: b.routeId, directionId: b.dir, scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.UNSCHEDULED },
        vehicle: { id: b.id, label: b.label },
        position: { latitude: b.lat, longitude: b.lon, bearing: b.bearing, speed: b.speedKmh / 3.6 },
        timestamp: Math.floor(ov.now / 1000),
        congestionLevel: CONG[(routeCong.get(b.routeId) ?? 'UNKNOWN_CONGESTION_LEVEL') as keyof typeof CONG],
        occupancyStatus: occupancyFor(b.crowd.level, b.crowd.confidence),
        currentStatus: b.dwellingAt ? rt.VehiclePosition.VehicleStopStatus.STOPPED_AT : rt.VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO,
      },
    })),
  });
  return msg;
}

export function tripUpdates(engine: Engine) {
  const now = engine.clock.now();
  const st = engine.liveState();
  const entity = [];
  for (const b of st.buses) {
    const r = engine.net.routes.get(b.routeId)!;
    const rv = st.routes.find((x) => x.id === b.routeId);
    const v = effectiveSpeed(b.speedKmh / 3.6, rv?.speedKmh != null ? rv.speedKmh / 3.6 : null);
    const upd = r.loopStops
      .map((ls) => ({ ls, e: etaSeconds(b.d, ls.d, r.path.length, r.loopStops, v) }))
      .filter((x) => x.e.distance > 20)
      .sort((a, b2) => a.e.distance - b2.e.distance)
      .slice(0, 5)
      .map((x) => ({ stopId: x.ls.stopId, stopSequence: x.ls.seq, arrival: { time: Math.floor((now + x.e.seconds * 1000) / 1000), uncertainty: 60 } }));
    entity.push({
      id: `tu-${b.id}`,
      tripUpdate: {
        trip: { tripId: `${b.routeId}_${b.dir}_T`, routeId: b.routeId, directionId: b.dir, scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.UNSCHEDULED },
        vehicle: { id: b.id, label: b.label },
        stopTimeUpdate: upd,
        timestamp: Math.floor(now / 1000),
      },
    });
  }
  return rt.FeedMessage.fromObject({ header: header(engine), entity });
}

export function serviceAlerts(engine: Engine) {
  const open = engine.alerts.filter((a) => a.status !== 'resolved' && a.routeId);
  return rt.FeedMessage.fromObject({
    header: header(engine),
    entity: open.map((a) => ({
      id: a.id,
      alert: {
        activePeriod: [{ start: Math.floor(a.createdAt / 1000) }],
        informedEntity: [{ routeId: a.routeId }],
        cause: a.type === 'traffic' ? rt.Alert.Cause.OTHER_CAUSE : rt.Alert.Cause.UNKNOWN_CAUSE,
        effect: a.type === 'traffic' ? rt.Alert.Effect.SIGNIFICANT_DELAYS : rt.Alert.Effect.OTHER_EFFECT,
        headerText: { translation: [{ text: a.title, language: 'az' }] },
        descriptionText: { translation: [{ text: a.recommendation, language: 'az' }] },
      },
    })),
  });
}

export function encode(msg: InstanceType<typeof rt.FeedMessage>): Uint8Array {
  return rt.FeedMessage.encode(msg).finish();
}

export function toJson(msg: InstanceType<typeof rt.FeedMessage>) {
  return rt.FeedMessage.toObject(msg, { enums: String, longs: Number, defaults: false });
}
