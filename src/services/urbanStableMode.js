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

// Stabil modda yalnızca bu üç değer değiştirilir. Diğer tüm alanlar son gerçek
// paketteki halleriyle korunur.
const VARIABLE_FIELDS = new Set(['bw', 'max_temperature', 'T_tank_C']);
const INTEGER_FIELDS = new Set(['max_temperature']);
const AMPLITUDES = {
    bw: 1.5,
    max_temperature: 0.6,
    T_tank_C: 0.08,
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

function buildSyntheticData(baseData, sequence) {
    const result = extractUrbanFields(baseData);

    config.URBAN_DATA_FIELDS.forEach((field, index) => {
        if (!VARIABLE_FIELDS.has(field)) return;
        const original = baseData[field];
        if (original === null || original === undefined || String(original).trim() === '') return;
        const numeric = Number(original);
        if (!Number.isFinite(numeric)) return;

        const phase = Math.sin(sequence * 0.79 + index * 1.17);
        const next = numeric + phase * AMPLITUDES[field];
        let formatted = formatLikeOriginal(field, original, next);

        // Tam sayı watt verisinde küçük salınım yuvarlanıp kaybolmasın.
        if (field === 'bw' && formatted === String(original)) {
            const precision = decimalPlaces(original);
            const minimumStep = 10 ** -precision;
            formatted = formatLikeOriginal(field, original, numeric + (phase >= 0 ? minimumStep : -minimumStep));
        }

        result[field] = formatted;
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
