// ============================================
// SECTOR API ROUTES (/api/sectors/*)
// Kayıtlı sektörler + realtime sector CSV/SSE
// ============================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const { SECTORS_DIR } = require('../config');
const sse = require('../services/sse');
const { analyzeRealtimeCsv } = require('../services/sectorAnalysis');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Sector kaydet (SADECE ADMIN — veri değiştiren işlem)
router.post('/api/sectors/save', requireAdmin, (req, res) => {
    const { name, sectors, optimumData, sectorCoordsArray, trackCoordinates } = req.body;

    if (!name || !sectors) {
        return res.status(400).json({ error: 'İsim ve sector verileri gerekli' });
    }

    const fileName = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    const filePath = path.join(SECTORS_DIR, fileName);

    const data = {
        name: name,
        sectors: sectors,
        optimumData: optimumData || [],
        sectorCoordsArray: sectorCoordsArray || [],
        trackCoordinates: trackCoordinates || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ success: true, fileName: fileName });
});

// Sector listesi — izleme için tüm kullanıcılar
router.get('/api/sectors/list', requireAuth, (req, res) => {
    const files = fs.readdirSync(SECTORS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const filePath = path.join(SECTORS_DIR, f);
            const data = JSON.parse(fs.readFileSync(filePath));
            return {
                fileName: f,
                name: data.name,
                sectorCount: data.sectors.length,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt
            };
        });

    res.json({ sectors: files });
});

// Sector yükle — izleme için tüm kullanıcılar
router.get('/api/sectors/load/:fileName', requireAuth, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.json') || fileName.includes('..')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(SECTORS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Sector bulunamadı' });
    }

    const data = JSON.parse(fs.readFileSync(filePath));
    res.json(data);
});

// Sector sil
router.delete('/api/sectors/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.json') || fileName.includes('..')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(SECTORS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Sector bulunamadı' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
});

// ============================================
// REALTIME SECTOR API
// ============================================

// Realtime CSV endpoint — güçlü PC bu adrese CSV gönderir
// Auth: requireAdmin middleware (admin session cookie'si gerekli)
router.post('/api/sectors/realtime-csv', requireAdmin, (req, res) => {
    // Body'yi metin olarak oku
    let csvText = '';
    if (typeof req.body === 'string') {
        csvText = req.body;
    } else if (Buffer.isBuffer(req.body)) {
        csvText = req.body.toString('utf8');
    } else if (req.body && typeof req.body === 'object' && req.body.csv) {
        // JSON gövdesiyle gönderim: { "csv": "s,lat,lon..." }
        csvText = req.body.csv;
    }

    if (!csvText || csvText.trim() === '') {
        return res.status(400).json({ error: 'CSV verisi boş' });
    }

    try {
        const { error, payload } = analyzeRealtimeCsv(csvText);
        if (error) {
            return res.status(400).json({ error });
        }

        sse.broadcastSectorUpdate(payload);

        const totalSubs = payload.sectors.reduce((sum, s) => sum + s.subSectors.length, 0);
        res.json({
            success: true,
            rows: payload.rowCount,
            sectors: payload.sectorCount,
            subSectors: totalSubs,
            broadcast: sse.raceSectorClients.size
        });
    } catch (err) {
        res.status(500).json({ error: 'CSV işleme hatası: ' + err.message });
    }
});

// Realtime sector SSE stream — /race sayfası buraya subscribe olur (izleme: tüm kullanıcılar)
router.get('/api/sectors/realtime-stream', requireAuth, (req, res) => {
    sse.setupSSEConnection(req, res, sse.raceSectorClients);
    console.log(`🔌 Race Sector SSE client bağlandı. Toplam: ${sse.raceSectorClients.size}`);

    // Yeni bağlanan client'a en son sektör verisini hemen gönder
    const lastPayload = sse.getLastRealtimeSectorPayload();
    if (lastPayload) {
        res.write(`data: ${JSON.stringify(lastPayload)}\n\n`);
    }
});

module.exports = router;
