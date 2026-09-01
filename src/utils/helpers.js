// ============================================
// GENEL YARDIMCI FONKSİYONLAR
// ============================================

// İki haneli sıfır dolgusu: 7 → "07"
const pad = n => String(n).padStart(2, '0');

// Günlük dosya adı oluştur (DD-MM-YYYY_verileri.csv)
function getDailyFileName(date = new Date(), suffix = '_verileri.csv') {
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}${suffix}`;
}

// Tarih damgalı dosya adı: prefix_DD-MM-YYYY_HH-MM-SS.csv
function timestampedFileName(prefix, now = new Date()) {
    return `${prefix}_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}` +
        `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.csv`;
}

// Süreyi formatla (HH:MM:SS.mmm)
function formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${milliseconds.toString().padStart(3, '0')}`;
}

// Basit cookie okuma — cookie-parser bağımlılığı eklemeden req.headers.cookie'den
// istenen cookie'nin değerini çıkarır (bulunamazsa null)
function getCookie(req, name) {
    const header = req.headers && req.headers.cookie;
    if (!header) return null;
    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (key === name) {
            try {
                return decodeURIComponent(part.slice(idx + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
}

// Dosya adı güvenlik kontrolü — path traversal engeli
function isSafeFileName(fileName, { extension = '.csv', prefix = null } = {}) {
    if (!fileName || typeof fileName !== 'string') return false;
    if (extension && !fileName.endsWith(extension)) return false;
    if (prefix && !fileName.startsWith(prefix)) return false;
    return !fileName.includes('..') && !fileName.includes('/') && !fileName.includes('\\');
}

// İndirme başlıklarını ayarla (RFC 5987 — Türkçe karakter ve boşluk desteği)
function setDownloadHeaders(res, fileName, contentType) {
    const encoded = encodeURIComponent(fileName);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encoded}`
    );
}

module.exports = { pad, getDailyFileName, timestampedFileName, formatDuration, isSafeFileName, setDownloadHeaders, getCookie };
