// ============================================
// URBAN HTTP STABİL MODU
// Gerçek HTTP akışı 1,5 saniye kesilirse son paketten küçük değişimler üreterek
// aynı Urban pipeline'ını besler. Varsayılan kapalıdır ve arayüz kontrolü yoktur.
// ============================================
const config = require('../config');
const state = require('../state');

const {
    URBAN_STABLE_TIMEOUT_MS: TIMEOUT_MS,
    URBAN_STABLE_CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    URBAN_STABLE_MIN_INTERVAL_MS: MIN_INTERVAL_MS,
    URBAN_STABLE_MAX_INTERVAL_MS: MAX_INTERVAL_MS,
} = config;

const STATIC_FIELDS = new Set([
    'ischarging', 'charge_time', 'enable', 'fwd_rev',
    'error_code', 'errorcode1', 'errorcode2', 'errorcode3', 'soc'
]);
const INTEGER_FIELDS = new Set([
    'gs', 'fet', 'fit', 'max_temperature', 'rpm', 'throttle', 'controller_temperature'
]);
const NON_NEGATIVE_FIELDS = new Set([
    'h', 'gsmspeed', 'gs', 'fv', 'fa', 'fw', 'eysv', 'eysc', 'eysw', 'oran', 'flow',
    'bv', 'bc', 'bw', 'bwh', 'soc', 'ke', 'charge_voltage', 'charge_current',
    'mv', 'mc', 'mw', 'rpm', 'throttle', 'controller_speed'
]);
const PERCENT_FIELDS = new Set(['oran', 'soc', 'throttle']);
const AMPLITUDES = {
    h: 0.15, gsmspeed: 0.15, fv: 0.03, fa: 0.06, fw: 1.2,
    eysv: 0.03, eysc: 0.05, eysw: 1.2, oran: 0.08,
    fet: 0.35, fit: 0.35, T_tank_C: 0.08,
    bv: 0.03, bc: 0.06, bw: 1.5, bwh: 0.05, max_temperature: 0.3, ke: 0.01,
    charge_voltage: 0.03, charge_current: 0.05,
    mv: 0.03, mc: 0.08, mw: 1.5,
    rpm: 6, throttle: 1, controller_temperature: 0.3, controller_speed: 0.15,
};

const stableMode = {
    enabled: false,
    generating: false,
    generatedCount: 0,
    lastRealData: null,
    lastRealReceivedAt: null,
    lastSyntheticData: null,
    lastSyntheticAt: null,
    estimatedIntervalMs: 1000,
};

let processor = null;
let timer = null;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function configureProcessor(callback) {
    processor = callback;
}

function extractUrbanFields(data) {
    return Object.fromEntries(config.URBAN_DATA_FIELDS.map(field => [field, data[field]]));
}

function decimalPlaces(value) {
    const match = String(value).match(/\.([0-9]+)/);
    return match ? Math.min(6, match[1].length) : 0;
}

function formatLikeOriginal(field, original, value) {
    if (INTEGER_FIELDS.has(field)) return String(Math.round(value));
    return value.toFixed(decimalPlaces(original));
}

function buildSyntheticData(baseData, sequence, elapsedMs) {
    const result = extractUrbanFields(baseData);
    const speed = Number(baseData.h);

    config.URBAN_DATA_FIELDS.forEach((field, index) => {
        if (STATIC_FIELDS.has(field)) return;
        const original = baseData[field];
        if (original === null || original === undefined || String(original).trim() === '') return;
        const numeric = Number(original);
        if (!Number.isFinite(numeric)) return;

        const phase = Math.sin(sequence * 0.79 + index * 1.17);
        let next = numeric;

        if (field === 'flow') {
            next += Math.max(0.001, (elapsedMs / 1000) * 0.01);
        } else if (field === 'x' || field === 'y') {
            // Araç duruyorsa konum sabit; hareketliyse yalnızca birkaç santimetrelik yumuşak sapma.
            if (Number.isFinite(speed) && Math.abs(speed) > 0.1) next += phase * 0.0000015;
        } else if (field === 'gs') {
            if (numeric >= 0 && numeric <= 32) next = clamp(Math.round(numeric + phase), 0, 32);
        } else {
            const amplitude = AMPLITUDES[field] ?? Math.max(Math.abs(numeric) * 0.001, 0.01);
            // Sıfır hız sıfır olarak kalsın; duran araç sahte olarak hareket etmesin.
            if ((field === 'h' || field === 'gsmspeed') && Math.abs(numeric) <= 0.05) return;
            next += phase * amplitude;
        }

        if (NON_NEGATIVE_FIELDS.has(field)) next = Math.max(0, next);
        if (PERCENT_FIELDS.has(field)) next = clamp(next, 0, 100);
        result[field] = formatLikeOriginal(field, original, next);
    });

    return result;
}

function observeRealUrbanHttpData(data, receivedAt = Date.now()) {
    if (stableMode.lastRealReceivedAt !== null) {
        const interval = receivedAt - stableMode.lastRealReceivedAt;
        if (interval >= MIN_INTERVAL_MS && interval <= TIMEOUT_MS) {
            const bounded = clamp(interval, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
            stableMode.estimatedIntervalMs = Math.round(stableMode.estimatedIntervalMs * 0.65 + bounded * 0.35);
        }
    }

    if (stableMode.generating) {
        console.log('✅ [URBAN STABLE] Gerçek HTTP verisi geri geldi; sahte üretim durdu.');
    }

    stableMode.lastRealData = extractUrbanFields(data);
    stableMode.lastRealReceivedAt = receivedAt;
    stableMode.lastSyntheticData = null;
    stableMode.lastSyntheticAt = null;
    stableMode.generating = false;
}

function contextAllowsGeneration() {
    return state.activeVehicle === 'urban' && state.connectionStatus.source === 'HTTP';
}

function stopSyntheticRun(message = null) {
    if (stableMode.generating && message) console.log(message);
    stableMode.generating = false;
    stableMode.lastSyntheticData = null;
    stableMode.lastSyntheticAt = null;
}

function checkStableMode(now = Date.now()) {
    if (!stableMode.enabled || !processor || !stableMode.lastRealData || stableMode.lastRealReceivedAt === null) return false;
    if (!contextAllowsGeneration()) {
        stopSyntheticRun('⏸️ [URBAN STABLE] Urban + HTTP aktif olmadığı için sahte üretim durdu.');
        return false;
    }

    const realDataAge = now - stableMode.lastRealReceivedAt;
    if (realDataAge < TIMEOUT_MS) return false;

    const previousAt = stableMode.lastSyntheticAt ?? stableMode.lastRealReceivedAt;
    const elapsedSincePrevious = now - previousAt;
    if (stableMode.lastSyntheticAt !== null && elapsedSincePrevious < stableMode.estimatedIntervalMs) return false;

    const sequence = stableMode.generatedCount + 1;
    const baseData = stableMode.lastSyntheticData ?? stableMode.lastRealData;
    const syntheticData = buildSyntheticData(baseData, sequence, elapsedSincePrevious);

    if (!stableMode.generating) {
        console.log(`⚠️ [URBAN STABLE] ${realDataAge} ms gerçek veri yok; sahte Urban akışı başladı.`);
    }

    stableMode.generating = true;
    stableMode.generatedCount = sequence;
    stableMode.lastSyntheticData = syntheticData;
    stableMode.lastSyntheticAt = now;
    processor(syntheticData, now, { source: 'HTTP', startNewFile: false, synthetic: true });
    return true;
}

function startTimer() {
    if (timer) return;
    timer = setInterval(() => checkStableMode(), CHECK_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

function setStableMode(enabled, { runTimer = true } = {}) {
    const next = Boolean(enabled);
    if (next === stableMode.enabled) {
        if (next && runTimer) startTimer();
        return getStableModeStatus();
    }

    stableMode.enabled = next;
    stableMode.generatedCount = 0;
    stopSyntheticRun();

    if (next) {
        if (runTimer) startTimer();
        console.log('🟢 [URBAN STABLE] Stabil mod AÇIK. 1500 ms kesintide sahte veri üretilecek.');
    } else {
        stopTimer();
        console.log('⚪ [URBAN STABLE] Stabil mod KAPALI. Yalnızca gerçek veri işlenecek.');
    }

    return getStableModeStatus();
}

function getStableModeStatus(now = Date.now()) {
    return {
        enabled: stableMode.enabled,
        generating: stableMode.generating,
        timeoutMs: TIMEOUT_MS,
        generatedCount: stableMode.generatedCount,
        lastRealReceivedAt: stableMode.lastRealReceivedAt,
        lastRealAgeMs: stableMode.lastRealReceivedAt === null ? null : Math.max(0, now - stableMode.lastRealReceivedAt),
        syntheticIntervalMs: stableMode.estimatedIntervalMs,
    };
}

module.exports = {
    stableMode,
    configureProcessor,
    observeRealUrbanHttpData,
    buildSyntheticData,
    checkStableMode,
    setStableMode,
    getStableModeStatus,
};
