const config = require('../config');

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
    // HTTP'de yalnızca güncel flow alanını kullan; varsa eski total_flow'u yok say.
    const { total_flow: _ignoredTotalFlow, ...currentQuery } = query;
    const data = parseUrbanHttpQuery(currentQuery);
    const errors = [];

    for (const field of config.URBAN_DATA_FIELDS) {
        const value = data[field];

        if (value === null || value === undefined) {
            errors.push({ field, reason: 'missing' });
        }
    }

    // total_flow, zorunlu güncel flow alanının yerine geçmez.
    if (!Object.hasOwn(query, 'flow')) {
        errors.push({ field: 'flow', reason: 'missing_current_name' });
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
