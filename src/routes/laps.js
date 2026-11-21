// ============================================
// LAP/RACE API ROUTES (/api/laps/*, /api/races/*)
// ============================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const { RACES_DIR } = require('../config');
const lapManager = require('../services/lapManager');
const sse = require('../services/sse');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { setDownloadHeaders } = require('../utils/helpers');

const router = express.Router();

// Lap SSE Stream - tüm kullanıcılar izleyebilir
router.get('/api/laps/stream', requireAuth, (req, res) => {
    sse.setupSSEConnection(req, res, sse.lapSSEClients);

    // İlk bağlantıda mevcut durumu gönder
    res.write(`data: ${JSON.stringify(lapManager.getLapStatePayload())}\n\n`);
});

// Yarışı başlat (SADECE ADMIN)
router.post('/api/laps/start', requireAdmin, (req, res) => {
    if (lapManager.getLapState().active) {
        return res.status(400).json({ error: 'Yarış zaten aktif' });
    }

    const { startTime, startJwh } = lapManager.startRace();
    res.json({
        success: true,
        message: 'Yarış başlatıldı',
        startTime,
        startJwh
    });
});

// Tur kaydet (SADECE ADMIN)
router.post('/api/laps/lap', requireAdmin, (req, res) => {
    if (!lapManager.getLapState().active) {
        return res.status(400).json({ error: 'Yarış aktif değil' });
    }

    const lap = lapManager.recordLap();
    res.json({
        success: true,
        message: `Tur ${lap.lapNum} kaydedildi`,
        lap: lap
    });
});

// Yarışı durdur (SADECE ADMIN)
router.post('/api/laps/stop', requireAdmin, (req, res) => {
    if (!lapManager.getLapState().active) {
        return res.status(400).json({ error: 'Yarış aktif değil' });
    }

    const { lapCount, savedFile } = lapManager.stopRace();
    res.json({
        success: true,
        message: 'Yarış durduruldu',
        lapCount,
        savedFile
    });
});

// Yarışı sıfırla (SADECE ADMIN) - mevcut verileri kaydet ve sıfırla
router.post('/api/laps/reset', requireAdmin, (req, res) => {
    const savedFile = lapManager.resetRace();
    res.json({
        success: true,
        message: savedFile ? `Yarış kaydedildi ve sıfırlandı` : 'Yarış sıfırlandı',
        savedFile: savedFile
    });
});

// Eski yarış kayıtlarını listele
router.get('/api/races/list', requireAuth, (req, res) => {
    if (!fs.existsSync(RACES_DIR)) {
        return res.json({ races: [] });
    }

    const races = fs.readdirSync(RACES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const filePath = path.join(RACES_DIR, f);
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) {
                return null;
            }
        })
        .filter(r => r !== null)
        .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    res.json({ races });
});

// Eski yarış CSV dosyasını indir (SADECE ADMIN)
router.get('/api/races/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(RACES_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// Eski yarış dosyasını yeniden adlandır (SADECE ADMIN)
router.post('/api/races/rename', requireAdmin, (req, res) => {
    const { oldFileName, newName } = req.body;

    if (!oldFileName || !newName) {
        return res.status(400).json({ error: 'Eski dosya adı ve yeni isim gerekli' });
    }
    if (oldFileName.includes('..') || oldFileName.includes('/') || oldFileName.includes('\\') || !oldFileName.endsWith('.csv')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    // Yeni ismi temizle:
    //   - Baş/son boşlukları kırp
    //   - Türkçe dahil harf/rakam/boşluk/tire/altçizgi dışındaki karakterleri çıkar
    //   - Ortadaki ardışık boşlukları tek boşlukla birleştir
    const safeNewName = newName
        .trim()
        .replace(/[^\p{L}\p{N} _\-]/gu, '')  // Unicode harf+rakam+izin verilenler
        .replace(/\s+/g, ' ')               // Ardışık boşlukları birleştir
        .trim();

    if (!safeNewName) {
        return res.status(400).json({ error: 'Geçersiz yeni isim' });
    }

    const oldBase = oldFileName.slice(0, -4); // '.csv' çıkar
    const newFileName = `${safeNewName}.csv`;
    const newBase = safeNewName;

    const oldCsvPath = path.join(RACES_DIR, `${oldBase}.csv`);
    const oldJsonPath = path.join(RACES_DIR, `${oldBase}.json`);
    const newCsvPath = path.join(RACES_DIR, `${newBase}.csv`);
    const newJsonPath = path.join(RACES_DIR, `${newBase}.json`);

    if (!fs.existsSync(oldCsvPath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
    if (fs.existsSync(newCsvPath)) {
        return res.status(409).json({ error: 'Bu isimde zaten bir dosya var' });
    }

    try {
        fs.renameSync(oldCsvPath, newCsvPath);
        if (fs.existsSync(oldJsonPath)) {
            const meta = JSON.parse(fs.readFileSync(oldJsonPath, 'utf8'));
            meta.fileName = newFileName;
            fs.writeFileSync(newJsonPath, JSON.stringify(meta, null, 2), 'utf8');
            fs.unlinkSync(oldJsonPath);
        }
        console.log(`📁 Yarış yeniden adlandırıldı: ${oldFileName} → ${newFileName}`);
        res.json({ success: true, newFileName });
    } catch (e) {
        res.status(500).json({ error: 'Yeniden adlandırma başarısız: ' + e.message });
    }
});

// Eski yarış dosyasını sil (SADECE ADMIN)
router.delete('/api/races/delete/:fileName(*)', requireAdmin, (req, res) => {
    // Express paramı otomatik decode eder; '*' wildcard ile '/' içeren adlar da işlenir
    const fileName = req.params.fileName;

    if (!fileName || !fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const base = fileName.slice(0, -4);
    const csvPath = path.join(RACES_DIR, `${base}.csv`);
    const jsonPath = path.join(RACES_DIR, `${base}.json`);

    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    try {
        fs.unlinkSync(csvPath);
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        console.log(`🗑️ Yarış silindi: ${fileName}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Silme başarısız: ' + e.message });
    }
});

module.exports = router;
