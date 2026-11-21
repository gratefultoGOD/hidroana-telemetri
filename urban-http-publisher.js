// URBAN HTTP Publisher - Simulated URBAN vehicle telemetry generator
//
// Sunucunun GET /data endpoint'ine güncel Urban alanlarını kısa HTTP adlarıyla
// gönderir. Sunucuda Urban + HTTP seçili olmalıdır.
//
// İsteğe bağlı ortam değişkenleri:
//   URBAN_HTTP_URL=http://127.0.0.1:3000/data
//   TELEMETRY_API_KEY=...
//   SEND_INTERVAL=1000

const http = require('http');
const https = require('https');
const config = require('./src/config');
const { buildUrbanHttpQuery } = require('./src/services/urbanPayload');

const ENDPOINT = new URL(process.env.URBAN_HTTP_URL || `http://127.0.0.1:${config.PORT}/data`);
const API_KEY = process.env.TELEMETRY_API_KEY || config.API_KEY;
const SEND_INTERVAL_MS = Math.max(100, Number.parseInt(process.env.SEND_INTERVAL, 10) || 1000);
const REQUEST_TIMEOUT_MS = 5000;

const KELLY_ERROR_CODES = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const route = [
    [41.0151, 28.9795], [41.0161, 28.9805], [41.0171, 28.9815],
    [41.0181, 28.9825], [41.0191, 28.9835], [41.0201, 28.9845],
    [41.0211, 28.9855], [41.0221, 28.9865], [41.0231, 28.9875],
    [41.0241, 28.9885], [41.0251, 28.9895], [41.0261, 28.9905]
];

let tick = 0;
let stopped = false;
let nextSendTimer = null;
let startNewTubitakFile = true;

function wave(base, amplitude, period, decimals = 1) {
    return (base + Math.sin((tick / period) * Math.PI * 2) * amplitude).toFixed(decimals);
}

function formatChargeTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function buildTelemetryData() {
    tick += 1;
    const position = route[tick % route.length];
    const phase = tick % 70;
    const isCharging = phase >= 45 && phase < 60;
    const controllerEnabled = phase < 65;
    const direction = phase < 25 ? 2 : phase < 40 ? 1 : phase < 62 ? 0 : 2;
    const kellyErrorCode = KELLY_ERROR_CODES[Math.floor(tick / 4) % KELLY_ERROR_CODES.length];
    const hasAksTestErrors = phase >= 66;

    const telemetryData = {
        h: wave(48, 23, 18),
        gsmspeed: wave(47, 22, 18),
        x: position[0].toFixed(6),
        y: position[1].toFixed(6),
        gs: String(tick % 33),

        fv: wave(42, 4, 20),
        fa: wave(14, 5, 13),
        fw: wave(590, 170, 15, 0),
        eysv: wave(52, 2, 23, 2),
        eysc: wave(11, 4, 17, 2),
        eysw: wave(570, 150, 19, 2),
        oran: wave(65, 20, 21, 2),
        flow: (12.5 + tick * 0.05).toFixed(2), // Araçtan hazır gelen toplamın test değeri
        fet: wave(35, 5, 22, 0),
        fit: wave(59, 8, 25, 0),
        T_tank_C: wave(31, 3, 30),

        bv: wave(52, 3, 24),
        bc: isCharging ? wave(13, 3, 12) : wave(21, 8, 17),
        bw: isCharging ? wave(680, 90, 12, 0) : wave(1080, 320, 16, 0),
        bwh: String((1200 + tick * 0.4).toFixed(1)),
        max_temperature: wave(42, 5, 28, 0),
        soc: String(Math.max(10, Math.min(100, Math.round(84 - tick * 0.02 + (isCharging ? 2 : 0))))),
        ke: String(Math.max(5, 39 - tick * 0.01 + (isCharging ? 0.5 : 0)).toFixed(1)),
        ischarging: isCharging ? 'charging' : 'not_charging',
        charge_voltage: isCharging ? wave(52, 1.5, 10) : '0',
        charge_current: isCharging ? wave(13, 2, 11) : '0',
        charge_time: isCharging ? formatChargeTime(120 - (phase - 45) * 4) : '',

        mv: wave(48, 4, 19),
        mc: wave(24, 10, 14),
        mw: wave(1150, 380, 15, 0),
        enable: controllerEnabled ? '1' : '0',
        fwd_rev: String(direction),
        rpm: wave(2600, 1300, 16, 0),
        throttle: wave(48, 38, 17, 0),
        controller_temperature: wave(54, 11, 26, 0),
        controller_speed: wave(46, 22, 18),
        error_code: String(kellyErrorCode),
        errorcode1: hasAksTestErrors ? '11' : '0',
        errorcode2: hasAksTestErrors ? '22' : '0',
        errorcode3: hasAksTestErrors ? '33' : '0'
    };

    const missingFields = config.URBAN_DATA_FIELDS.filter((field) => telemetryData[field] === undefined);
    if (missingFields.length > 0) {
        throw new Error(`Eksik URBAN alanları: ${missingFields.join(', ')}`);
    }

    return telemetryData;
}

function createRequestUrl(telemetryData, { startNewFile = false } = {}) {
    const requestUrl = new URL(ENDPOINT);
    requestUrl.search = buildUrbanHttpQuery(telemetryData, API_KEY).toString();
    requestUrl.searchParams.set('s', startNewFile ? '1' : '0');
    return requestUrl;
}

function request(requestUrl) {
    const client = requestUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = client.get(requestUrl, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: body.trim() }));
        });

        req.on('timeout', () => req.destroy(new Error(`İstek ${REQUEST_TIMEOUT_MS}ms içinde tamamlanmadı`)));
        req.on('error', reject);
    });
}

async function sendTelemetryData() {
    try {
        const telemetryData = buildTelemetryData();
        const response = await request(createRequestUrl(telemetryData, { startNewFile: startNewTubitakFile }));

        if (response.statusCode !== 200) {
            const hint = response.statusCode === 400 && response.body === 'DISABLED'
                ? ' (Sunucuda Urban + HTTP seçilmeli)'
                : '';
            throw new Error(`HTTP ${response.statusCode}: ${response.body || 'Boş cevap'}${hint}`);
        }
        startNewTubitakFile = false;

        const capacitor = response.body === '1' ? 'Açık' : 'Kapalı';
        console.log(
            `📤 HTTP 200 | Hız=${telemetryData.h}km/h | SOC=${telemetryData.soc}%`
            + ` | FC/EYS=${telemetryData.fv}V/${telemetryData.eysv}V | Oran=${telemetryData.oran}% | Toplam Flow=${telemetryData.flow}`
            + ` | Kelly=${telemetryData.error_code} | AKS=${telemetryData.errorcode1}/${telemetryData.errorcode2}/${telemetryData.errorcode3}`
            + ` | Süperkapasitör=${capacitor}`
        );
    } catch (error) {
        console.error(`❌ Urban HTTP gönderim hatası: ${error.message}`);
    } finally {
        if (!stopped) nextSendTimer = setTimeout(sendTelemetryData, SEND_INTERVAL_MS);
    }
}

if (require.main === module) {
    console.log('🔌 URBAN HTTP publisher başlatıldı');
    console.log(`🌐 Endpoint: ${ENDPOINT.origin}${ENDPOINT.pathname}`);
    console.log(`📊 Alan sayısı: ${config.URBAN_DATA_FIELDS.length} (kısa HTTP adları)`);
    console.log(`⏱️  Gönderim aralığı: ${SEND_INTERVAL_MS}ms`);
    console.log('📋 TÜBİTAK: ilk başarılı istekte s=1, sonraki isteklerde s=0');
    console.log('⚠️  Sunucuda Urban + HTTP seçili olmalıdır.\n');

    sendTelemetryData();

    process.on('SIGINT', () => {
        stopped = true;
        if (nextSendTimer) clearTimeout(nextSendTimer);
        console.log('\n🛑 URBAN HTTP publisher durduruldu');
        process.exit(0);
    });
}

module.exports = { buildTelemetryData, createRequestUrl };
