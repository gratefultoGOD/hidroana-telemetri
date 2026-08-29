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

function buildUrbanHttpQuery(data, apiKey) {
    data = normalizeUrbanFlow(data);
    const query = new URLSearchParams({ key: apiKey });
    config.URBAN_DATA_FIELDS.forEach(field => {
        query.set(config.URBAN_HTTP_FIELD_NAMES[field] || field, data[field] ?? '');
    });
    return query;
}

module.exports = { parseUrbanHttpQuery, buildUrbanHttpQuery, normalizeUrbanFlow };
