const config = require('../config');

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const INTEGER_FIELDS = new Set([
    'gs', 'enable', 'fwd_rev', 'rpm', 'throttle',
    'controller_temperature', 'error_code', 'errorcode1', 'errorcode2', 'errorcode3'
]);
const CHARGING_STATES = new Set(['0', '1', 'charging', 'not_charging']);

// Eski sözleşmedeki flow anlıktı; total_flow varsa toplamı esas al.
// Boş toplamı anlık değerle doldurma. Sıfır geçerlidir, yeniden hesaplama yapılmaz.
function normalizeUrbanFlow(data) {
    const { total_flow, ...normalized } = data;
    normalized.flow = (Object.hasOwn(data, 'total_flow') ? total_flow : data.flow) ?? null;
    return normalized;
}

function parseUrbanHttpQuery(query) {
    query = normalizeUrbanFlow(query);
    const data = Object.fromEntries(config.URBAN_DATA_FIELDS.map(field => {
        const shortName = config.URBAN_HTTP_FIELD_NAMES[field] || field;
        return [field, query[shortName] ?? query[field] ?? null];
    }));

    // Eski URL: gsmspeed=GPS hızı, gs=sinyal. Yeni URL: gs=GPS hızı, gq=sinyal.
    // gsmspeed varsa GPS için o açık ad kullanılır; gq yoksa eski gs sinyaldir.
    data.gsmspeed = query.gsmspeed ?? query.gs ?? null;
    data.gs = query.gq ?? (query.gsmspeed !== undefined ? query.gs ?? null : null);
    return data;
}

function validateUrbanHttpQuery(query) {
    const data = parseUrbanHttpQuery(query);
    const errors = [];

    for (const field of config.URBAN_DATA_FIELDS) {
        const value = data[field];

        if (value === null || value === undefined) {
            errors.push({ field, reason: 'missing' });
            continue;
        }
        if (Array.isArray(value)) {
            errors.push({ field, reason: 'duplicate' });
            continue;
        }

        const text = String(value);
        // charge_time alanı zorunludur ancak araç şarj olmuyorsa boş olabilir.
        if (field !== 'charge_time' && text.length === 0) {
            errors.push({ field, reason: 'empty' });
            continue;
        }
        if (text !== text.trim()) {
            errors.push({ field, reason: 'whitespace' });
            continue;
        }

        if (config.URBAN_NUMERIC_FIELDS.includes(field)) {
            if (!DECIMAL_PATTERN.test(text) || !Number.isFinite(Number(text))) {
                errors.push({ field, reason: 'invalid_number' });
                continue;
            }
            if (INTEGER_FIELDS.has(field) && !Number.isInteger(Number(text))) {
                errors.push({ field, reason: 'invalid_integer' });
            }
        }
    }

    // Güncel HTTP sözleşmesinde toplam akışın alan adı doğrudan flow'dur.
    if (!Object.hasOwn(query, 'flow')) {
        errors.push({ field: 'flow', reason: 'missing_current_name' });
    }
    if (Object.hasOwn(query, 'total_flow')) {
        errors.push({ field: 'total_flow', reason: 'obsolete_field' });
    }

    if (!errors.some(error => error.field === 'ischarging') && !CHARGING_STATES.has(String(data.ischarging))) {
        errors.push({ field: 'ischarging', reason: 'invalid_value' });
    }
    if (!errors.some(error => error.field === 'gs')) {
        const signal = Number(data.gs);
        if (!Number.isInteger(signal) || signal < 0 || signal > 32) {
            errors.push({ field: 'gs', reason: 'out_of_range' });
        }
    }
    if (!errors.some(error => error.field === 'enable') && !['0', '1'].includes(String(data.enable))) {
        errors.push({ field: 'enable', reason: 'invalid_value' });
    }
    if (!errors.some(error => error.field === 'fwd_rev') && !['0', '1', '2'].includes(String(data.fwd_rev))) {
        errors.push({ field: 'fwd_rev', reason: 'invalid_value' });
    }
    if (!errors.some(error => error.field === 'throttle')) {
        const throttle = Number(data.throttle);
        if (throttle < 0 || throttle > 100) errors.push({ field: 'throttle', reason: 'out_of_range' });
    }

    return { valid: errors.length === 0, data, errors };
}

function buildUrbanHttpQuery(data, apiKey) {
    data = normalizeUrbanFlow(data);
    const query = new URLSearchParams({ key: apiKey });
    config.URBAN_DATA_FIELDS.forEach(field => {
        query.set(config.URBAN_HTTP_FIELD_NAMES[field] || field, data[field] ?? '');
    });
    return query;
}

module.exports = { parseUrbanHttpQuery, validateUrbanHttpQuery, buildUrbanHttpQuery, normalizeUrbanFlow };
