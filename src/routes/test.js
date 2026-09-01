// ============================================
// TEST MODU API ROUTES (/api/test/*)
// ============================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const { TEST_DIR } = require('../config');
const testModeService = require('../services/testMode');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatDuration, isSafeFileName, setDownloadHeaders } = require('../utils/helpers');
const { csvToXlsxBuffer } = require('../utils/xlsx');

const router = express.Router();
const { testMode } = testModeService;

// Test başlat (SADECE ADMIN)
router.post('/api/test/start', requireAdmin, (req, res) => {
    if (testMode.active) {
        return res.status(400).json({ error: 'Zaten aktif bir test var', testName: testMode.testName });
    }

    const { testName, startTime, vehicle } = testModeService.startTest();
    console.log(`Test başlatıldı: ${testName}`);

    res.json({
        success: true,
        message: 'Test başlatıldı',
        testName,
        startTime,
        vehicle
    });
});

// Test durdur (SADECE ADMIN)
router.post('/api/test/stop', requireAdmin, async (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }

    try {
        const { testName, realDuration, dataCount, vehicle } = await testModeService.stopTest();

        res.json({
            success: true,
            message: 'Test durduruldu',
            testName: testName,
            duration: formatDuration(realDuration),
            durationMs: realDuration,
            dataCount: dataCount,
            vehicle
        });
    } catch (error) {
        console.error('Test kaydı durdurulamadı:', error);
        res.status(500).json({ error: 'Test verileri dosyaya kaydedilemedi; kayıt kapatılmadı. Tekrar durdurmayı deneyin.' });
    }
});

// Test durumu
router.get('/api/test/status', requireAuth, (req, res) => {
    if (!testMode.active) {
        return res.json({
            active: false,
            paused: false
        });
    }

    const rawElapsed = Date.now() - testMode.startTime;
    // Eğer şu an duraklatılmışsa, mevcut duraklatma süresini de ekle
    const currentPausedMs = testMode.paused && testMode.pausedAt
        ? (Date.now() - testMode.pausedAt)
        : 0;
    const elapsed = rawElapsed - testMode.pausedElapsed - currentPausedMs;

    res.json({
        active: true,
        paused: testMode.paused,
        testName: testMode.testName,
        vehicle: testMode.vehicle,
        startTime: new Date(testMode.startTime).toISOString(),
        elapsed: elapsed,
        elapsedFormatted: formatDuration(elapsed),
        pendingData: testMode.pendingTestData.length
    });
});

// Test duraklat (SADECE ADMIN)
router.post('/api/test/pause', requireAdmin, (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }
    if (testMode.paused) {
        return res.status(400).json({ error: 'Test zaten duraklatılmış' });
    }

    testModeService.pauseTest();
    res.json({ success: true, message: 'Test duraklatıldı', testName: testMode.testName });
});

// Test devam ettir (SADECE ADMIN)
router.post('/api/test/resume', requireAdmin, (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }
    if (!testMode.paused) {
        return res.status(400).json({ error: 'Test duraklatılmamış' });
    }

    const pauseDuration = testModeService.resumeTest();
    console.log(`▶️ Test devam ediyor: ${testMode.testName} | Duraklatma süresi: ${formatDuration(pauseDuration)}`);
    res.json({ success: true, message: 'Test devam ediyor', testName: testMode.testName, pauseDuration });
});

// Test dosyalarını listele — izleme için tüm kullanıcılar (oynatıcı listesi)
router.get('/api/test/files', requireAuth, async (req, res) => {
    const files = await testModeService.getTestFiles();
    res.json({ files });
});

// Test dosyası İÇERİĞİNİ oku — oynatma için (indirme DEĞİL, tüm kullanıcılar).
// Content-Disposition yok: dosyayı diske kaydetmez, sadece oynatıcı okur.
router.get('/api/test/content/:fileName', requireAuth, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName)) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.sendFile(filePath);
});

// Test dosyasını indir (SADECE ADMIN)
router.get('/api/test/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    // Güvenlik kontrolü
    if (!isSafeFileName(fileName)) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// Test dosyasını XLSX olarak indir (SADECE ADMIN)
router.get('/api/test/download-xlsx/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName)) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    try {
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const xlsxBuffer = csvToXlsxBuffer(csvContent, 'Test Verisi');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Dosya boş' });
        }
        const xlsxFileName = fileName.replace('.csv', '.xlsx');
        setDownloadHeaders(res, xlsxFileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsxBuffer);
    } catch (error) {
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// Test dosyasını yeniden adlandır (SADECE ADMIN)
router.patch('/api/test/rename/:fileName', requireAdmin, (req, res) => {
    const oldFileName = req.params.fileName;
    const { newName } = req.body;

    // Güvenlik kontrolü - eski dosya adı
    if (!isSafeFileName(oldFileName)) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    // Güvenlik kontrolü - yeni dosya adı
    if (!newName || typeof newName !== 'string') {
        return res.status(400).json({ error: 'Yeni dosya adı gerekli' });
    }

    // Yeni dosya adını temizle ve formatla
    let cleanName = newName.trim();

    // .csv uzantısı yoksa ekle
    if (!cleanName.endsWith('.csv')) {
        cleanName += '.csv';
    }

    // Geçersiz karakterleri kontrol et
    if (cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\') || cleanName.includes(':')) {
        return res.status(400).json({ error: 'Dosya adında geçersiz karakterler var' });
    }

    const oldFilePath = path.join(TEST_DIR, oldFileName);
    const newFilePath = path.join(TEST_DIR, cleanName);

    // Eski dosya var mı kontrol et
    if (!fs.existsSync(oldFilePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    // Yeni isimde dosya zaten var mı kontrol et
    if (fs.existsSync(newFilePath) && oldFileName !== cleanName) {
        return res.status(409).json({ error: 'Bu isimde bir dosya zaten mevcut' });
    }

    try {
        fs.renameSync(oldFilePath, newFilePath);
        console.log(`📝 Test dosyası yeniden adlandırıldı: ${oldFileName} → ${cleanName}`);
        res.json({
            success: true,
            message: `Dosya yeniden adlandırıldı`,
            oldName: oldFileName,
            newName: cleanName
        });
    } catch (error) {
        res.status(500).json({ error: 'Dosya yeniden adlandırılamadı' });
    }
});

// Test dosyasını sil (SADECE ADMIN)
router.delete('/api/test/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName) || fileName.includes('~')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ Test dosyası silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

module.exports = router;
