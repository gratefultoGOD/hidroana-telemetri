// ============================================
// TELEMETRİ API ROUTES
// SSE stream, anlık veri, sayaçlar, indirme/silme işlemleri
// ============================================
const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('../config');
const state = require('../state');
const telemetryStore = require('../services/telemetryStore');
const sse = require('../services/sse');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDailyFileName, isSafeFileName, setDownloadHeaders } = require('../utils/helpers');
const { csvToXlsxBuffer } = require('../utils/xlsx');

const { DATA_DIR, CSV_HEADERS, SSE_STALE_THRESHOLD_MS } = config;
const router = express.Router();

// SSE Stream Endpoint - Event-Driven veri akışı
router.get('/api/telemetry/stream', requireAuth, (req, res) => {
    sse.setupSSEConnection(req, res, sse.sseClients, { noDelay: true });
    console.log(`🔌 SSE client bağlandı. Toplam: ${sse.sseClients.size}`);

    // İlk bağlantıda mevcut veriyi gönder — sadece yeterince tazeyse
    const latest = state.latestTelemetryData;
    if (latest && latest.receivedAt) {
        const dataAge = Date.now() - latest.receivedAt;
        if (dataAge <= SSE_STALE_THRESHOLD_MS) {
            res.write(`data: ${JSON.stringify(latest)}\n\n`);
        } else {
            console.log(`⏳ SSE: Son veri ${(dataAge / 1000).toFixed(1)}s eski, yeni client'a gönderilmedi.`);
        }
    }
});

// Eski polling endpoint (geriye uyumluluk için)
router.get('/api/telemetry', requireAuth, (req, res) => {
    if (!state.latestTelemetryData) {
        return res.status(503).json({ error: 'Henüz veri alınmadı' });
    }

    // Son veri alım zamanını kontrol et (5 saniyeden eski mi?)
    const now = Date.now();
    const lastDataTime = state.latestTelemetryData.receivedAt || 0;
    const timeSinceLastData = now - lastDataTime;

    // 5 saniyeden fazla veri gelmemişse bağlantı kesildi
    if (timeSinceLastData > 5000) {
        console.log(`⚠️ Veri akışı kesildi (${timeSinceLastData}ms önce)`);
        return res.status(503).json({
            error: 'Veri akışı kesildi',
            lastDataTime: lastDataTime,
            timeSinceLastData: timeSinceLastData
        });
    }

    res.json(state.latestTelemetryData);
});

router.get('/api/telemetry/count', requireAuth, (req, res) => {
    // Cache'den oku — dosya I/O yok, event loop bloklanmaz
    res.json({
        count: telemetryStore.getDailyAveragesCount(),
        pendingCount: telemetryStore.getPendingCount(),
        todayFile: getDailyFileName(),
        availableDays: telemetryStore.getAvailableDaysCount()
    });
});

router.get('/api/telemetry/averages', requireAuth, (req, res) => {
    res.json(telemetryStore.calculateAverages());
});

// Son alınan verinin zaman damgasını döndür
router.get('/api/telemetry/last-received', requireAuth, (req, res) => {
    if (!state.latestTelemetryData) {
        return res.json({ lastReceived: null });
    }
    res.json({
        lastReceived: state.latestTelemetryData.receivedAt || null,
        date: state.latestTelemetryData.date || null,
        time: state.latestTelemetryData.time || null
    });
});

// Mevcut günlerin listesi (SADECE ADMIN)
router.get('/api/telemetry/days', requireAdmin, async (req, res) => {
    const days = await telemetryStore.getAvailableDays();
    res.json({ days });
});

// Belirli bir günün verisini indir (SADECE ADMIN)
router.get('/api/telemetry/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    // Güvenlik kontrolü - sadece günlük csv dosyaları
    if (!isSafeFileName(fileName, { extension: '_verileri.csv' })) {
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
router.get('/api/telemetry/download-xlsx/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { extension: '_verileri.csv' })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    sendCsvAsXlsx(res, filePath, fileName, 'Telemetri');
});

// Bugünün verisini indir (bekleyen veriler dahil) (SADECE ADMIN)
router.get('/api/telemetry/download-today', requireAdmin, (req, res) => {
    // Önce bekleyen verileri dosyaya yaz
    telemetryStore.flushDataToFile();

    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz veri toplanmadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// Bugünün verisini XLSX olarak indir (SADECE ADMIN)
router.get('/api/telemetry/download-today-xlsx', requireAdmin, (req, res) => {
    telemetryStore.flushDataToFile();

    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz veri toplanmadı' });
    }

    sendCsvAsXlsx(res, filePath, fileName, 'Bugün');
});

// Belirli bir günün verisini sil (SADECE ADMIN)
router.delete('/api/telemetry/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { extension: '_verileri.csv' })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ Dosya silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

// Bugünün verilerini temizle (SADECE ADMIN)
router.delete('/api/telemetry/clear', requireAdmin, (req, res) => {
    const clearedCount = telemetryStore.clearTodayData();
    console.log(`Bugünün verileri temizlendi. Silinen kayıt: ${clearedCount}`);
    res.json({ success: true, clearedCount });
});

// CSV export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
router.get('/api/telemetry/csv', requireAdmin, async (req, res) => {
    const csv = await buildCombinedCsv(true);
    if (csv === null) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }

    const filename = `telemetry_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    setDownloadHeaders(res, filename, 'text/csv; charset=utf-8');
    res.send(csv);
});

// XLSX export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
router.get('/api/telemetry/xlsx', requireAdmin, async (req, res) => {
    const csv = await buildCombinedCsv(false);
    if (csv === null) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }

    try {
        const xlsxBuffer = csvToXlsxBuffer(csv, 'Tüm Veriler');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Veri bulunamadı' });
        }
        const filename = `telemetry_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        setDownloadHeaders(res, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsxBuffer);
    } catch (error) {
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// ── Yardımcılar ──

// CSV dosyasını XLSX'e çevirip indirme yanıtı olarak gönder
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
    // Önce bekleyen verileri dosyaya yaz
    await telemetryStore.flushDataToFile();

    const days = await telemetryStore.getAvailableDays();
    if (days.length === 0) return null;

    let csv = (withBom ? '\uFEFF' : '') + CSV_HEADERS.join(';') + '\n';

    for (const day of days) {
        const filePath = path.join(DATA_DIR, day.fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        lines.slice(1).forEach(line => {
            if (line.trim()) csv += line + '\n';
        });
    }
    return csv;
}

module.exports = router;
