// ============================================
// VERİ İŞLEME HATTI (Data Pipeline)
// Ham telemetri verisini parse eder, zenginleştirir,
// depolama servislerine dağıtır ve SSE ile yayınlar.
// ============================================
const config = require('../config');
const state = require('../state');
const telemetryStore = require('./telemetryStore');
const urbanTelemetryStore = require('./urbanTelemetryStore');
const testModeService = require('./testMode');
const tubitak = require('./tubitak');
const { findBestFlowMatch } = require('./flow');
const { broadcastToClients, broadcastToUrbanClients } = require('./sse');
const { normalizeUrbanFlow } = require('./urbanPayload');

// Yıldız ile ayrılmış ham veriyi JSON'a dönüştür
function parseStarSeparatedData(rawMessage) {
    let dataString = rawMessage;
    if (rawMessage.includes('_')) {
        dataString = rawMessage.split('_')[1];
    }
    const values = dataString.split('*');
    const data = {};
    config.DATA_FIELDS.forEach((field, index) => {
        data[field] = values[index] !== undefined ? values[index] : null;
    });
    return data;
}

// URBAN aracı için yıldız ile ayrılmış ham veriyi JSON'a dönüştür
function parseUrbanStarSeparatedData(rawMessage) {
    let dataString = rawMessage.trim();
    const prefixEnd = dataString.indexOf('_');
    const firstSeparator = dataString.indexOf('*');
    if (prefixEnd >= 0 && (firstSeparator < 0 || prefixEnd < firstSeparator)) {
        dataString = dataString.slice(prefixEnd + 1);
    }
    const values = dataString.split('*');
    const layouts = [config.URBAN_DATA_FIELDS, config.URBAN_LEGACY_41_DATA_FIELDS, config.URBAN_LEGACY_DATA_FIELDS];
    const validLengths = layouts.map(fields => fields.length);
    if (values.at(-1) === '' && validLengths.includes(values.length - 1)) values.pop();
    const fields = layouts.find(fields => values.length === fields.length);
    if (!fields) {
        throw new Error(`Geçersiz Urban paket uzunluğu: ${values.length}`);
    }
    const data = Object.fromEntries(config.URBAN_DATA_FIELDS.map(field => [field, null]));
    fields.forEach((field, index) => {
        data[field] = values[index] !== undefined ? values[index] : null;
    });
    return normalizeUrbanFlow(data);
}

// URBAN aracı verisini işle ve kaydet (ayrı pipeline — ana araçtan bağımsız)
function processIncomingUrbanData(data, receivedAt = Date.now(), tubitakOptions = {}) {
    state.urbanDataCounter++;

    const now = new Date(receivedAt);
    const previousReceivedAt = state.latestUrbanTelemetryData?.receivedAt;
    const dataWithTimestamp = {
        // Toplam akış flow adıyla taşınır; hesaplama, biriktirme veya sıfırlama yok.
        ...normalizeUrbanFlow(data),
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0'),
        interval_ms: previousReceivedAt == null ? null : Math.max(0, receivedAt - previousReceivedAt),
        timestamp: now.getTime(),
        receivedAt: now.getTime(),
        dataCounter: state.urbanDataCounter
    };

    urbanTelemetryStore.checkDayRollover(now);
    urbanTelemetryStore.updateRunningAverages(dataWithTimestamp);

    if (state.urbanDataCounter % 10 === 0) {
        console.log(`📊 [URBAN] Running avg update: count=${urbanTelemetryStore.getDailyAveragesCount()}, h=${dataWithTimestamp.h}`);
    }

    state.latestUrbanTelemetryData = dataWithTimestamp;

    urbanTelemetryStore.enqueueData(dataWithTimestamp);

    // Test modu aktifse test verilerini de kaydet (duraklatılmışsa kaydedilmez)
    testModeService.recordTestData(dataWithTimestamp, now);

    // TÜBİTAK kaydı yalnızca URBAN aracından alınır.
    tubitak.recordTubitakData(dataWithTimestamp, now, tubitakOptions);

    state.urbanConnectionStatus.connected = true;
    state.urbanConnectionStatus.lastUpdate = now.toISOString();
    state.urbanConnectionStatus.error = null;

    broadcastToUrbanClients(dataWithTimestamp);

    if (state.urbanDataCounter % 10 === 0) {
        const speed = dataWithTimestamp.h || 'N/A';
        const soc = dataWithTimestamp.soc || 'N/A';
        const testInfo = testModeService.testMode.active ? ' | 🧪 TEST AKTİF' : '';
        console.log(`📥 [URBAN] Veri alındı (#${state.urbanDataCounter}): Hız=${speed} km/h, SOC=${soc}% | Bekleyen: ${urbanTelemetryStore.getPendingCount()}${testInfo}`);
    }
}

// Veriyi işle ve kaydet
function processIncomingData(data) {
    state.dataCounter++; // Her yeni veri geldiğinde counter'ı artır

    const now = new Date();
    const dataWithTimestamp = {
        ...data, // Önce gelen veriyi spread et
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0'),
        timestamp: now.getTime(),
        receivedAt: now.getTime(),      // Frontend için veri alım zamanı
        dataCounter: state.dataCounter  // Frontend için veri sayacı
    };

    // Gün değişimi kontrolü ve Running Average güncellemesi
    telemetryStore.checkDayRollover(now);
    telemetryStore.updateRunningAverages(dataWithTimestamp);

    // Log throttle: her 10 veride 1 kez logla (event loop koruması)
    if (state.dataCounter % 10 === 0) {
        console.log(`📊 Running avg update: count=${telemetryStore.getDailyAveragesCount()}, fv_val=${dataWithTimestamp.fv}, fv_avg=${telemetryStore.getDailyAverages().fv?.toFixed(4)}`);
    }

    state.latestTelemetryData = dataWithTimestamp;

    // Flow verisi varsa en yakın zamanlı flow ile birleştir — kaydı ve SSE'yi aynı objeyle yap
    const matchedFlow = findBestFlowMatch(now.getTime());
    if (matchedFlow !== null) {
        dataWithTimestamp.realInstantFlow = matchedFlow.instantFlow; // anlık flow
        dataWithTimestamp.realTotalFlow = matchedFlow.totalFlow;     // toplam flow
        dataWithTimestamp.hasRealFlow = true;
        if (state.dataCounter % 10 === 0) {
            console.log(`💧 Flow eşleşmesi: anlık=${matchedFlow.instantFlow}, toplam=${matchedFlow.totalFlow}`);
        }
    } else {
        dataWithTimestamp.realInstantFlow = null;
        dataWithTimestamp.realTotalFlow = null;
        dataWithTimestamp.hasRealFlow = false;
    }

    // Günlük CSV kuyruğuna ekle (realFlow dahil) — eşik dolunca dosyaya yazar
    telemetryStore.enqueueData(dataWithTimestamp);

    // Test modu aktifse test verilerini de kaydet (duraklatılmışsa kaydedilmez)
    testModeService.recordTestData(dataWithTimestamp, now);

    state.connectionStatus.connected = true;
    state.connectionStatus.lastUpdate = now.toISOString();
    state.connectionStatus.error = null;

    // SSE ile tüm bağlı client'lara veri gönder
    broadcastToClients(dataWithTimestamp);

    if (state.dataCounter % 10 === 0) {
        const speed = dataWithTimestamp.h || 'N/A';
        const soc = dataWithTimestamp.soc || 'N/A';
        const testInfo = testModeService.testMode.active ? ' | 🧪 TEST AKTİF' : '';
        console.log(`📥 [${state.connectionStatus.source}] Veri alındı (#${state.dataCounter}): Hız=${speed} km/h, SOC=${soc}% | Bugün: ${telemetryStore.getDailyAveragesCount()} | Bekleyen: ${telemetryStore.getPendingCount()}${testInfo}`);
    }
}

module.exports = { parseStarSeparatedData, processIncomingData, parseUrbanStarSeparatedData, processIncomingUrbanData };
