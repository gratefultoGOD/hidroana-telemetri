// ============================================
// FLOW VERİSİ BUFFER SERVİSİ
// Flow sensörü normal telemetriden daha hızlı veri gönderir;
// gelen her flow değeri timestamp ile buffer'da tutulur ve
// normal veri geldiğinde en yakın zamanlı flow ile eşleştirilir.
// ============================================
const { FLOW_MATCH_WINDOW, FLOW_BUFFER_MAX } = require('../config');

let flowBuffer = [];             // { instantFlow, totalFlow, timestamp }
let hasReceivedFlowData = false; // Hiç flow verisi alındı mı?

// Ham flow string'ini parse et — format: "anlık_flow*toplam_flow"
// "11.27*0.123450" → { instantFlow: 11.27, totalFlow: 0.12345 }
function parseFlowValue(rawValue) {
    let instantFlow = null;
    let totalFlow = null;
    if (typeof rawValue === 'string' && rawValue.includes('*')) {
        const [a, b] = rawValue.split('*').map(parseFloat);
        if (!isNaN(a)) instantFlow = a;
        if (!isNaN(b)) totalFlow = b;
    } else {
        // Eski tek değer formatı için geri uyumluluk
        const v = parseFloat(rawValue);
        if (!isNaN(v)) instantFlow = v;
    }
    return { instantFlow, totalFlow };
}

// Flow verisini buffer'a ekle
function addFlowToBuffer(rawValue, timestamp) {
    hasReceivedFlowData = true;
    const { instantFlow, totalFlow } = parseFlowValue(rawValue);

    flowBuffer.push({ instantFlow, totalFlow, timestamp });
    if (flowBuffer.length > FLOW_BUFFER_MAX) {
        flowBuffer.shift();
    }
    // Pencere dışındaki eski verileri temizle
    const cutoff = timestamp - FLOW_MATCH_WINDOW;
    flowBuffer = flowBuffer.filter(f => f.timestamp >= cutoff);
}

// Normal veri timestamp'ına en yakın flow verisini bul
// Döndürülen değer: { instantFlow, totalFlow } veya null
function findBestFlowMatch(dataTimestamp) {
    if (!hasReceivedFlowData || flowBuffer.length === 0) return null;

    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < flowBuffer.length; i++) {
        const diff = Math.abs(flowBuffer[i].timestamp - dataTimestamp);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }

    // Pencere içinde değilse eşleşme yok
    if (bestIdx === -1 || bestDiff > FLOW_MATCH_WINDOW) return null;

    const { instantFlow, totalFlow } = flowBuffer[bestIdx];
    return { instantFlow, totalFlow };
}

module.exports = { parseFlowValue, addFlowToBuffer, findBestFlowMatch };
