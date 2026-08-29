// ============================================
// URBAN ARACI TELEMETRİ API ROUTES
// SSE stream, anlık veri, sayaçlar, indirme/silme işlemleri
// telemetry.js ile aynı yapı — URBAN aracının kendi veri kümesi üzerinde çalışır
// ============================================
const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('../config');
const state = require('../state');
const urbanTelemetryStore = require('../services/urbanTelemetryStore');
const sse = require('../services/sse');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isSafeFileName, setDownloadHeaders } = require('../utils/helpers');
const { csvToXlsxBuffer } = require('../utils/xlsx');
const { combineUrbanCsvContents } = require('../utils/urbanCsv');

const { URBAN_DATA_DIR: DATA_DIR, URBAN_CSV_HEADERS: CSV_HEADERS, SSE_STALE_THRESHOLD_MS } = config;
const FILE_SUFFIX = urbanTelemetryStore.FILE_SUFFIX;
const router = express.Router();

// SSE Stream Endpoint - Event-Driven veri akışı
router.get('/api/urban-telemetry/stream', requireAuth, (req, res) => {
    sse.setupSSEConnection(req, res, sse.urbanSseClients, { noDelay: true });
    console.log(`🔌 URBAN SSE client bağlandı. Toplam: ${sse.urbanSseClients.size}`);

    // İlk bağlantıda mevcut veriyi gönder — sadece yeterince tazeyse
    const latest = state.latestUrbanTelemetryData;
    if (latest && latest.receivedAt) {
        const dataAge = Date.now() - latest.receivedAt;
        if (dataAge <= SSE_STALE_THRESHOLD_MS) {
            res.write(`data: ${JSON.stringify(latest)}\n\n`);
        } else {
            console.log(`⏳ URBAN SSE: Son veri ${(dataAge / 1000).toFixed(1)}s eski, yeni client'a gönderilmedi.`);
        }
    }
});

// Eski polling endpoint (geriye uyumluluk için)
router.get('/api/urban-telemetry', requireAuth, (req, res) => {
    if (!state.latestUrbanTelemetryData) {
        return res.status(503).json({ error: 'Henüz URBAN verisi alınmadı' });
    }

    const now = Date.now();
    const lastDataTime = state.latestUrbanTelemetryData.receivedAt || 0;
    const timeSinceLastData = now - lastDataTime;

    if (timeSinceLastData > 5000) {
        return res.status(503).json({
            error: 'URBAN veri akışı kesildi',
            lastDataTime: lastDataTime,
            timeSinceLastData: timeSinceLastData
        });
    }

    res.json(state.latestUrbanTelemetryData);
});

router.get('/api/urban-telemetry/count', requireAuth, (req, res) => {
    res.json({
        count: urbanTelemetryStore.getDailyAveragesCount(),
        pendingCount: urbanTelemetryStore.getPendingCount(),
        todayFile: urbanTelemetryStore.getTodayFileName(),
        availableDays: urbanTelemetryStore.getAvailableDaysCount()
    });
});

router.get('/api/urban-telemetry/averages', requireAuth, (req, res) => {
    res.json(urbanTelemetryStore.calculateAverages());
});

// Son alınan verinin zaman damgasını döndür
router.get('/api/urban-telemetry/last-received', requireAuth, (req, res) => {
    if (!state.latestUrbanTelemetryData) {
        return res.json({ lastReceived: null });
    }
    res.json({
        lastReceived: state.latestUrbanTelemetryData.receivedAt || null,
        date: state.latestUrbanTelemetryData.date || null,
        time: state.latestUrbanTelemetryData.time || null
    });
});

// Mevcut günlerin listesi (SADECE ADMIN)
router.get('/api/urban-telemetry/days', requireAdmin, async (req, res) => {
    const days = await urbanTelemetryStore.getAvailableDays();
    res.json({ days });
});

// Belirli bir günün verisini indir (SADECE ADMIN)
router.get('/api/urban-telemetry/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { extension: FILE_SUFFIX })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// Belirli bir günün verisini XLSX olarak indir (SADECE ADMIN)
router.get('/api/urban-telemetry/download-xlsx/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { extension: FILE_SUFFIX })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    sendCsvAsXlsx(res, filePath, fileName, 'URBAN Telemetri');
});

// Bugünün verisini indir (bekleyen veriler dahil) (SADECE ADMIN)
router.get('/api/urban-telemetry/download-today', requireAdmin, async (req, res) => {
    await urbanTelemetryStore.flushDataToFile();

    const fileName = urbanTelemetryStore.getTodayFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz URBAN verisi toplanmadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// Bugünün verisini XLSX olarak indir (SADECE ADMIN)
router.get('/api/urban-telemetry/download-today-xlsx', requireAdmin, async (req, res) => {
    await urbanTelemetryStore.flushDataToFile();

    const fileName = urbanTelemetryStore.getTodayFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz URBAN verisi toplanmadı' });
    }

    sendCsvAsXlsx(res, filePath, fileName, 'Bugün (URBAN)');
});

// Belirli bir günün verisini sil (SADECE ADMIN)
router.delete('/api/urban-telemetry/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { extension: FILE_SUFFIX })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    urbanTelemetryStore.invalidateFileCache();
    console.log(`🗑️ URBAN dosyası silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

// Bugünün verilerini temizle (SADECE ADMIN)
router.delete('/api/urban-telemetry/clear', requireAdmin, (req, res) => {
    const clearedCount = urbanTelemetryStore.clearTodayData();
    console.log(`URBAN bugünün verileri temizlendi. Silinen kayıt: ${clearedCount}`);
    res.json({ success: true, clearedCount });
});

// CSV export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
router.get('/api/urban-telemetry/csv', requireAdmin, async (req, res) => {
    const csv = await buildCombinedCsv(true);
    if (csv === null) {
        return res.status(404).json({ error: 'Henüz URBAN verisi toplanmadı' });
    }

    const filename = `urban_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    setDownloadHeaders(res, filename, 'text/csv; charset=utf-8');
    res.send(csv);
});

// XLSX export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
router.get('/api/urban-telemetry/xlsx', requireAdmin, async (req, res) => {
    const csv = await buildCombinedCsv(false);
    if (csv === null) {
        return res.status(404).json({ error: 'Henüz URBAN verisi toplanmadı' });
    }

    try {
        const xlsxBuffer = csvToXlsxBuffer(csv, 'URBAN Tüm Veriler');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Veri bulunamadı' });
        }
        const filename = `urban_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        setDownloadHeaders(res, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsxBuffer);
    } catch (error) {
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// ── Yardımcılar ──

function sendCsvAsXlsx(res, filePath, fileName, sheetName) {
    try {
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const xlsxBuffer = csvToXlsxBuffer(csvContent, sheetName);
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Dosya boş' });
        }
        const xlsxFileName = fileName.replace('.csv', '.xlsx');
        setDownloadHeaders(res, xlsxFileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsxBuffer);
    } catch (error) {
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
}

// Tüm günlerin dosyalarını tek CSV'de birleştir (asenkron); veri yoksa null
async function buildCombinedCsv(withBom) {
    await urbanTelemetryStore.flushDataToFile();

    const days = await urbanTelemetryStore.getAvailableDays();
    if (days.length === 0) return null;

    const contents = [];

    for (const day of days) {
        const filePath = path.join(DATA_DIR, day.fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        contents.push(content);
    }
    return combineUrbanCsvContents(contents, CSV_HEADERS, withBom);
}

module.exports = router;
