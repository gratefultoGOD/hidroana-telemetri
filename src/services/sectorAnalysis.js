// ============================================
// SUNUCU TARAFLI SEKTÖR ANALİZİ
// Realtime CSV'den sektör/alt-sektör tespiti
// ============================================

// Medyan hesaplama yardımcısı
function calcMedianServer(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Alt-sektör tespiti gürültü eşiği
const SUB_SECTOR_NOISE = 1.5; // km/h

// Tek parça (düz) alt-sektör oluştur
function flatSubSector(rows, sectorId) {
    return {
        id: sectorId + '.1',
        startMeter: rows[0].s,
        endMeter: rows[rows.length - 1].s,
        entrySpeed: rows[0].v,
        exitSpeed: rows[rows.length - 1].v,
        type: 'flat',
        coords: rows.map(r => [r.lat, r.lon])
    };
}

// Alt-sektör tespit fonksiyonu — hız trendine göre accel/decel segmentleri
function detectSubSectorsServer(rows, sectorId) {
    if (rows.length < 2) {
        return [flatSubSector(rows, sectorId)];
    }

    // 3 noktalı hareketli ortalama ile hız serisini yumuşat
    const smoothed = rows.map((r, i) => {
        if (i === 0 || i === rows.length - 1) return r.v;
        return (rows[i - 1].v + r.v + rows[i + 1].v) / 3;
    });

    // İlk trendi belirle
    let currentTrend = null;
    let segStart = 0;
    for (let i = 1; i < smoothed.length; i++) {
        const diff = smoothed[i] - smoothed[segStart];
        if (Math.abs(diff) >= SUB_SECTOR_NOISE) {
            currentTrend = diff > 0 ? 'accel' : 'decel';
            break;
        }
    }
    if (!currentTrend) {
        return [flatSubSector(rows, sectorId)];
    }

    const subSectors = [];
    let subCount = 0;
    let lastPeak = smoothed[segStart];

    for (let i = 1; i < smoothed.length; i++) {
        const diff = smoothed[i] - lastPeak;
        let trendChanged = false;
        if (currentTrend === 'accel' && diff < -SUB_SECTOR_NOISE) trendChanged = true;
        else if (currentTrend === 'decel' && diff > SUB_SECTOR_NOISE) trendChanged = true;

        if (currentTrend === 'accel' && smoothed[i] > lastPeak) lastPeak = smoothed[i];
        else if (currentTrend === 'decel' && smoothed[i] < lastPeak) lastPeak = smoothed[i];

        if (trendChanged || i === smoothed.length - 1) {
            const endIdx = (trendChanged && i > 0) ? i - 1 : i;
            subCount++;
            const segRows = rows.slice(segStart, endIdx + 1);
            if (segRows.length >= 1) {
                subSectors.push({
                    id: sectorId + '.' + subCount,
                    startMeter: segRows[0].s,
                    endMeter: segRows[segRows.length - 1].s,
                    entrySpeed: Math.round(segRows[0].v * 10) / 10,
                    exitSpeed: Math.round(segRows[segRows.length - 1].v * 10) / 10,
                    type: currentTrend,
                    coords: segRows.map(r => [r.lat, r.lon])
                });
            }
            if (trendChanged && i < smoothed.length - 1) {
                segStart = endIdx;
                currentTrend = currentTrend === 'accel' ? 'decel' : 'accel';
                lastPeak = smoothed[segStart];
            }
        }
    }

    if (subSectors.length === 0) {
        subSectors.push(flatSubSector(rows, sectorId));
    }
    return subSectors;
}

// Ham CSV metnini parse edip sektör analizi payload'ı üret
// Hata durumunda { error } döndürür, başarıda { payload }
function analyzeRealtimeCsv(csvText) {
    // ── Parse ──
    const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) {
        return { error: 'CSV boş veya başlık yok' };
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''));
    const idxS = header.indexOf('s') !== -1 ? header.indexOf('s') : header.indexOf('zaman_ms');
    const idxLat = header.indexOf('lat');
    const idxLon = header.indexOf('lon');
    let idxV = header.indexOf('v_kmh');
    if (idxV < 0) idxV = header.indexOf('hiz_kmh');
    let idxSector = header.indexOf('sector');
    if (idxSector < 0) idxSector = header.indexOf('sectors');

    if (idxLat < 0 || idxLon < 0) {
        return { error: "CSV'de lat/lon sütunu bulunamadı" };
    }
    if (idxV < 0) {
        return { error: "CSV'de v_kmh veya hiz_kmh sütunu bulunamadı" };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < header.length) continue;
        const sVal = idxS >= 0 ? parseFloat(cols[idxS]) : i;
        const latVal = parseFloat(cols[idxLat]);
        const lonVal = parseFloat(cols[idxLon]);
        const vVal = parseFloat(cols[idxV]);
        if (isNaN(latVal) || isNaN(lonVal) || isNaN(vVal)) continue;

        let sectorVal;
        if (idxSector >= 0) {
            const raw = parseFloat(cols[idxSector]);
            sectorVal = isNaN(raw) ? 1 : Math.floor(raw);
        } else {
            sectorVal = -1;
        }
        rows.push({ s: sVal, lat: latVal, lon: lonVal, v: vVal, sector: sectorVal });
    }

    if (rows.length === 0) {
        return { error: 'Geçerli satır bulunamadı' };
    }

    // Sector sütunu yoksa otomatik 7 eşit sektör
    if (rows[0].sector === -1) {
        const sMin = Math.min(...rows.map(r => r.s));
        const sMax = Math.max(...rows.map(r => r.s));
        const sectorWidth = (sMax - sMin) / 7;
        rows.forEach(r => {
            r.sector = Math.min(7, Math.floor((r.s - sMin) / sectorWidth) + 1);
        });
    }

    // Sektör haritası oluştur (alt-sektör destekli)
    const sectorRowsMap = {};
    rows.forEach(r => {
        if (!sectorRowsMap[r.sector]) sectorRowsMap[r.sector] = [];
        sectorRowsMap[r.sector].push(r);
    });

    const sectorNos = Object.keys(sectorRowsMap).map(Number).sort((a, b) => a - b);

    // sectors array (alt-sektörlerle birlikte)
    const sectors = sectorNos.map(no => {
        const sRows = sectorRowsMap[no].sort((a, b) => a.s - b.s);
        const subSectors = detectSubSectorsServer(sRows, no);
        return {
            id: no,
            startMeter: sRows[0].s,
            endMeter: sRows[sRows.length - 1].s,
            entrySpeed: Math.round(sRows[0].v * 10) / 10,
            exitSpeed: Math.round(sRows[sRows.length - 1].v * 10) / 10,
            subSectors: subSectors
        };
    });

    // SSE payload
    const payload = {
        type: 'sector_update',
        sectors,
        optimumData: rows.map(r => ({ s: Math.round(r.s), v: r.v })),
        sectorCoordsArray: sectorNos.map(no => ({
            sectorId: no,
            coords: sectorRowsMap[no].map(r => [r.lat, r.lon])
        })),
        trackCoordinates: rows.map(r => [r.lat, r.lon]),
        timestamp: Date.now(),
        rowCount: rows.length,
        sectorCount: sectorNos.length
    };

    return { payload };
}

module.exports = { calcMedianServer, detectSubSectorsServer, analyzeRealtimeCsv };
