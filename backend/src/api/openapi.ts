// OpenAPI 3.1 sənədi — /api/docs ünvanında Swagger UI ilə göstərilir.
const level = { type: 'string', enum: ['low', 'medium', 'high'], description: 'aşağı / orta / yüksək' };
const err = { description: 'Xəta', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } };
const ok = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Smart Transit Baku — Crowdsourcing Engine API',
    version: '1.0.0',
    description:
      'Bakı ictimai nəqliyyatı üçün real vaxt marşrut və yük analitikası. Sərnişin modulu (ETA, sıxlıq bildirişi, marşrut planı) və operator modulu (sıxlıq xəritəsi, avtomatik xəbərdarlıqlar, ehtiyat avtobus).\n\nReal vaxt yenilənmələr: `ws://<host>/ws` (mesaj növləri: `state`, `alert`, `alert.update`, `dispatch`, `clock`).',
  },
  tags: [{ name: 'Sərnişin' }, { name: 'Operator' }, { name: 'AVL / GPS' }, { name: 'Simulyasiya' }, { name: 'GTFS' }],
  components: {
    securitySchemes: {
      device: { type: 'apiKey', in: 'header', name: 'x-device-token', description: '/api/session ilə alınır; x-device-id başlığı ilə birlikdə göndərilir' },
      internal: { type: 'apiKey', in: 'header', name: 'x-internal-key', description: 'Avtobus terminalları / simulyator' },
    },
  },
  paths: {
    '/api/health': { get: { tags: ['Sərnişin'], summary: 'Sağlamlıq yoxlaması', responses: { 200: ok('OK') } } },
    '/api/session': { post: { tags: ['Sərnişin'], summary: 'Anonim cihaz tokeni al (HMAC imzalı)', responses: { 201: ok('deviceId və token') } } },
    '/api/network': { get: { tags: ['Sərnişin'], summary: 'Xətlər, dayanacaqlar, həndəsə', responses: { 200: ok('Şəbəkə') } } },
    '/api/state': { get: { tags: ['Sərnişin'], summary: 'Bütün avtobusların canlı vəziyyəti', responses: { 200: ok('Vəziyyət') } } },
    '/api/routes/{id}/live': {
      get: { tags: ['Sərnişin'], summary: 'Xəttin canlı avtobusları və sıxlığı', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'M6' }], responses: { 200: ok('Xətt'), 404: err } },
    },
    '/api/stops/{id}/arrivals': {
      get: {
        tags: ['Sərnişin'],
        summary: 'Dayanacağa gələn avtobuslar: ETA, sıxlıq, etibar, "bunu burax" tövsiyəsi',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'GEN' }],
        responses: { 200: ok('Gəlişlər'), 404: err },
      },
    },
    '/api/plan': {
      get: {
        tags: ['Sərnişin'],
        summary: 'Sıxlığı nəzərə alan marşrut planı (≤1 köçürmə)',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string' }, example: 'ELM' },
          { name: 'to', in: 'query', required: true, schema: { type: 'string' }, example: 'GEN' },
        ],
        responses: { 200: ok('Variantlar'), 400: err },
      },
    },
    '/api/reports': {
      post: {
        tags: ['Sərnişin'],
        summary: 'Sıxlıq bildirişi göndər',
        security: [{ device: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['level'],
                properties: {
                  context: { type: 'string', enum: ['bus', 'stop'], description: 'bus = avtobusun içindəyəm, stop = dayanacaqda gözləyirəm' },
                  level,
                  busId: { type: 'string' },
                  routeId: { type: 'string' },
                  stopId: { type: 'string' },
                  lat: { type: 'number' },
                  lon: { type: 'number' },
                  accuracy: { type: 'number' },
                },
              },
              example: { context: 'bus', level: 'high', busId: 'M6-2', lat: 40.39, lon: 49.83, accuracy: 20 },
            },
          },
        },
        responses: { 201: ok('Qəbul edildi'), 400: err, 401: err, 429: err },
      },
    },
    '/api/gps': { post: { tags: ['AVL / GPS'], summary: 'Avtobus GPS ping-i (tək və ya massiv)', security: [{ internal: [] }], responses: { 202: ok('Qəbul edildi'), 401: err } } },
    '/api/operator/overview': { get: { tags: ['Operator'], summary: 'Xətlər üzrə sıxlıq, etibar, səbəb, interval, proqnoz, domino, xəbərdarlıqlar', responses: { 200: ok('İcmal') } } },
    '/api/operator/alerts': { get: { tags: ['Operator'], summary: 'Xəbərdarlıqlar', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['new', 'ack', 'resolved'] } }], responses: { 200: ok('Siyahı') } } },
    '/api/operator/alerts/{id}': {
      patch: {
        tags: ['Operator'],
        summary: 'Xəbərdarlığın statusunu dəyiş',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['new', 'ack', 'resolved'] } } } } } },
        responses: { 200: ok('Yeniləndi'), 404: err },
      },
    },
    '/api/operator/dispatch': {
      post: {
        tags: ['Operator'],
        summary: 'Ehtiyat avtobusu xəttə burax və ya başqa xətdən köçür',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['routeId'], properties: { routeId: { type: 'string' }, source: { type: 'string', enum: ['reserve', 'transfer'] }, fromRouteId: { type: 'string' }, alertId: { type: 'string' } } },
              example: { routeId: 'M6', source: 'reserve' },
            },
          },
        },
        responses: { 201: ok('Göndərildi'), 409: err },
      },
    },
    '/api/operator/history': { get: { tags: ['Operator'], summary: 'Vaxt maşını: son N dəqiqənin anlıq görüntüləri', parameters: [{ name: 'minutes', in: 'query', schema: { type: 'integer', default: 120 } }], responses: { 200: ok('Kadrlar') } } },
    '/api/operator/forecast/{routeId}': { get: { tags: ['Operator'], summary: 'Xətt üzrə sıxlıq proqnozu', parameters: [{ name: 'routeId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Proqnoz') } } },
    '/api/sim/state': { get: { tags: ['Simulyasiya'], summary: 'Simulyasiya saatı və aktiv ssenarilər', responses: { 200: ok('Vəziyyət') } } },
    '/api/sim/speed': { post: { tags: ['Simulyasiya'], summary: 'Saatın sürəti (×1, ×10, ×30)', requestBody: { content: { 'application/json': { example: { factor: 10 } } } }, responses: { 200: ok('OK') } } },
    '/api/sim/scenario': {
      post: {
        tags: ['Simulyasiya'],
        summary: 'Demo ssenarisi: peak | fake | bots | traffic | bunch | reset',
        requestBody: { content: { 'application/json': { example: { name: 'peak', routeId: 'M6' } } } },
        responses: { 200: ok('OK') },
      },
    },
    '/gtfs/static.zip': { get: { tags: ['GTFS'], summary: 'Statik GTFS (agency, routes, stops, shapes, trips, stop_times, frequencies)', responses: { 200: { description: 'ZIP' } } } },
    '/gtfs-rt/vehicle-positions': {
      get: { tags: ['GTFS'], summary: 'GTFS-RT VehiclePositions (occupancy_status, congestion_level)', parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json'] } }], responses: { 200: { description: 'protobuf və ya JSON' } } },
    },
    '/gtfs-rt/trip-updates': { get: { tags: ['GTFS'], summary: 'GTFS-RT TripUpdates (ETA)', parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json'] } }], responses: { 200: { description: 'protobuf və ya JSON' } } } },
    '/gtfs-rt/alerts': { get: { tags: ['GTFS'], summary: 'GTFS-RT Alerts', parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json'] } }], responses: { 200: { description: 'protobuf və ya JSON' } } } },
  },
};
