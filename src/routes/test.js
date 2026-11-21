const express = require('express');
const fs = require('fs');
const path = require('path');

const { TEST_DIR } = require('../config');
const testModeService = require('../services/testMode');
const { TEST_OPTIONS, readTestDetails, readTestNote } = require('../services/testDetails');
const {
    YEAR_FOLDER, TEST_TEXT_COLUMNS, isTestFileName, testFilePath, testPlaybackCsv, appendTestAfterNote, updateTestRecord
} = require('../services/testArchive');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatDuration, setDownloadHeaders } = require('../utils/helpers');
const { csvToXlsxBuffer } = require('../utils/xlsx');

const router = express.Router();
const { testMode } = testModeService;

router.get('/api/test/options', requireAdmin, (req, res) => {
    res.json(TEST_OPTIONS);
});

router.post('/api/test/start', requireAdmin, (req, res) => {
    if (testMode.active) {
        return res.status(400).json({ error: 'Zaten aktif bir test var', testName: testMode.testName });
    }
    let details;
    try {
        details = readTestDetails(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        const status = testModeService.startTest(details);
        console.log(`Test başlatıldı: ${status.testName}`);
        res.json({ success: true, ...status });
    } catch (error) {
        console.error('Test başlatılamadı:', error);
        res.status(500).json({ error: 'Test arşivi açılamadı.' });
    }
});

router.post('/api/test/stop', requireAdmin, async (req, res) => {
    if (!testMode.active) return res.status(400).json({ error: 'Aktif test yok' });
    try {
        const { realDuration, ...record } = await testModeService.stopTest();
        res.json({ success: true, ...record, duration: formatDuration(realDuration), durationMs: realDuration });
    } catch (error) {
        console.error('Test kaydı durdurulamadı:', error);
        res.status(500).json({ error: 'Test verileri dosyaya kaydedilemedi. Tekrar durdurmayı deneyin.' });
    }
});

router.get('/api/test/status', requireAuth, (req, res) => {
    const status = testModeService.getTestStatus();
    if (req.session?.userRole !== 'admin') delete status.pauseNote;
    res.json(status);
});

function requireRunningTest(req, res, next) {
    if (!testMode.active) return res.status(400).json({ error: 'Aktif test yok' });
    if (testMode.stopping) return res.status(409).json({ error: 'Test kaydı kapatılıyor.' });
    next();
}

router.post('/api/test/pause', requireAdmin, requireRunningTest, (req, res) => {
    if (testMode.paused) return res.status(400).json({ error: 'Test zaten duraklatılmış' });
    res.json({ success: true, ...testModeService.pauseTest() });
});

router.patch('/api/test/pause-note', requireAdmin, requireRunningTest, (req, res) => {
    if (!testMode.paused || req.body?.pausedAt !== testMode.pausedAt) {
        return res.status(409).json({ error: 'Bu duraklama sona erdi.' });
    }
    try {
        testModeService.setPauseNote(readTestNote(req.body.note));
        res.json({ success: true, ...testModeService.getTestStatus() });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/api/test/resume', requireAdmin, requireRunningTest, (req, res) => {
    if (!testMode.paused) return res.status(400).json({ error: 'Test duraklatılmamış' });
    const pauseDuration = testModeService.resumeTest();
    res.json({ success: true, pauseDuration, ...testModeService.getTestStatus() });
});

router.get('/api/test/files', requireAuth, async (req, res, next) => {
    try {
        const files = await testModeService.getTestFiles({ includeDetails: req.session?.userRole === 'admin' });
        res.json({ files });
    } catch (error) {
        next(error);
    }
});

function requireTestFile(req, res, next) {
    const { fileName } = req.params;
    const year = req.query.year;
    if (!isTestFileName(fileName) || (year !== undefined && (typeof year !== 'string' || !YEAR_FOLDER.test(year)))) {
        return res.status(400).json({ error: 'Geçersiz test dosyası veya arşiv yılı.' });
    }
    const archiveYear = year === undefined ? null : Number(year);
    if (testModeService.isActiveTestFile(fileName, archiveYear)) {
        return res.status(409).json({ error: 'Bu testin kaydı sürüyor.' });
    }
    const filePath = testFilePath(TEST_DIR, fileName, archiveYear);
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
    req.testFile = { fileName, filePath, archiveYear };
    next();
}

router.get('/api/test/content/:fileName', requireAuth, requireTestFile, async (req, res, next) => {
    try {
        const csv = await fs.promises.readFile(req.testFile.filePath, 'utf8');
        res.type('text/csv').set('Cache-Control', 'no-store').send(testPlaybackCsv(csv));
    } catch (error) {
        next(error);
    }
});

router.get('/api/test/download/:fileName', requireAdmin, requireTestFile, (req, res) => {
    const { fileName, filePath } = req.testFile;
    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

router.get('/api/test/download-xlsx/:fileName', requireAdmin, requireTestFile, async (req, res) => {
    const { fileName, filePath } = req.testFile;
    try {
        const csv = await fs.promises.readFile(filePath, 'utf8');
        const xlsx = csvToXlsxBuffer(csv, 'Test Verisi', TEST_TEXT_COLUMNS);
        if (!xlsx) return res.status(404).json({ error: 'Dosya boş' });
        setDownloadHeaders(res, fileName.replace(/\.csv$/, '.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsx);
    } catch (error) {
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

router.post('/api/test/after-note/:fileName', requireAdmin, requireTestFile, (req, res) => {
    let note;
    try {
        note = readTestNote(req.body?.note);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        if (!appendTestAfterNote(req.testFile.filePath, note)) {
            return res.status(400).json({ error: 'Bu test dosyasına test sonrası notu eklenemiyor.' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Test sonrası notu kaydedilemedi.' });
    }
});

router.patch('/api/test/details/:fileName', requireAdmin, requireTestFile, async (req, res) => {
    const { revision, pauseNotes } = req.body ?? {};
    if (typeof revision !== 'string' || !Array.isArray(pauseNotes)) {
        return res.status(400).json({ error: 'Test ayrıntılarını tekrar açın.' });
    }
    let changes;
    try {
        changes = {
            revision,
            details: readTestDetails(req.body, { allowIncomplete: true }),
            afterNotes: readTestNote(req.body.afterNotes),
            pauseNotes: pauseNotes.map(note => readTestNote(note))
        };
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        const isReserved = fileName => testModeService.isActiveTestFile(fileName, req.testFile.archiveYear);
        const record = await updateTestRecord(req.testFile, changes, isReserved);
        if (!record) return res.status(409).json({ error: 'Kayıt değişti. Test ayrıntılarını tekrar açıp düzenleyin.' });
        res.json({ success: true, ...record });
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({ error: 'Test kaydı bulunamadı.' });
        console.error('Test ayrıntıları kaydedilemedi:', error);
        res.status(500).json({ error: 'Test ayrıntıları kaydedilemedi.' });
    }
});

router.patch('/api/test/rename/:fileName', requireAdmin, requireTestFile, (req, res) => {
    const { fileName, filePath, archiveYear } = req.testFile;
    const requestedName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : '';
    if (!requestedName) return res.status(400).json({ error: 'Yeni dosya adı gerekli' });
    const newName = requestedName.endsWith('.csv') ? requestedName : requestedName + '.csv';
    if (!isTestFileName(newName)) return res.status(400).json({ error: 'Dosya adında geçersiz karakterler var' });
    const newPath = path.join(path.dirname(filePath), newName);
    if (newName !== fileName && (testModeService.isActiveTestFile(newName, archiveYear) || fs.existsSync(newPath))) {
        return res.status(409).json({ error: 'Bu isimde bir dosya zaten mevcut' });
    }
    try {
        fs.renameSync(filePath, newPath);
        res.json({ success: true, oldName: fileName, newName });
    } catch (error) {
        res.status(500).json({ error: 'Dosya yeniden adlandırılamadı' });
    }
});

router.delete('/api/test/delete/:fileName', requireAdmin, requireTestFile, (req, res) => {
    fs.unlinkSync(req.testFile.filePath);
    res.json({ success: true });
});

module.exports = router;
