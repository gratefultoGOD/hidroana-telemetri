// ============================================
// TÜBİTAK API ROUTES (/api/tubitak/*)
// ============================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const { TUBITAK_DIR } = require('../config');
const { getTubitakFiles } = require('../services/tubitak');
const { requireAdmin } = require('../middleware/auth');
const { isSafeFileName, setDownloadHeaders } = require('../utils/helpers');

const router = express.Router();

// TÜBİTAK dosyalarını listele (SADECE ADMIN)
router.get('/api/tubitak/files', requireAdmin, (req, res) => {
    const files = getTubitakFiles();
    res.json({ files });
});

// TÜBİTAK dosyasını indir (SADECE ADMIN)
router.get('/api/tubitak/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { prefix: 'tubitak_' })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TUBITAK_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    setDownloadHeaders(res, fileName, 'text/csv; charset=utf-8');
    res.sendFile(filePath);
});

// TÜBİTAK dosyasını sil (SADECE ADMIN)
router.delete('/api/tubitak/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!isSafeFileName(fileName, { prefix: 'tubitak_' })) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TUBITAK_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ TÜBİTAK dosyası silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

module.exports = router;
