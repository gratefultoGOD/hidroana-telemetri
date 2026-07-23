// ============================================
// TÜBİTAK KAYIT SİSTEMİ
// Her server başlatmasında (veya 60s veri boşluğunda) eşsiz bir dosya
// oluşturulur; her gelen veri anında kaydedilir.
// Başlık: zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_V;kalan_enerji_Wh
// ============================================
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('../config');
const state = require('../state');
const { timestampedFileName } = require('../utils/helpers');

const { TUBITAK_DIR, TUBITAK_HEADERS, TUBITAK_FLUSH_THRESHOLD, TUBITAK_GAP_MS } = config;

const tubitakSession = {
    startTime: null,    // İlk veri alındığında set edilir (ms, epoch)
    lastDataTime: null, // Son veri alım zamanı (ms, epoch) — gap kontrolü için
    fileName: null,     // Aktif TÜBİTAK dosyasının adı
    pending: []         // Yazılmayı bekleyen satırlar
};

// TÜBİTAK oturumunu başlat — now parametresi ile sıfır-zaman tutarsızlığı önlenir
function initTubitakSession(now) {
    const fileName = timestampedFileName('tubitak', now);

    tubitakSession.startTime = now.getTime(); // processIncomingData'daki now ile aynı
    tubitakSession.fileName = fileName;
    tubitakSession.pending = [];

    // Başlık satırını yaz
    const filePath = path.join(TUBITAK_DIR, fileName);
    fs.writeFileSync(filePath, '\uFEFF' + TUBITAK_HEADERS + '\n', 'utf8');
    console.log(`📋 TÜBİTAK kayıt dosyası oluşturuldu: ${fileName}`);
}

// Gelen telemetri verisini TÜBİTAK formatında kaydet
// İlk veri veya TUBITAK_GAP_MS'den uzun boşluk → yeni dosya başlat
function recordTubitakData(data, now) {
    const gap = tubitakSession.lastDataTime
        ? (now.getTime() - tubitakSession.lastDataTime)
        : 0;
    if (!tubitakSession.startTime || gap > TUBITAK_GAP_MS) {
        if (gap > TUBITAK_GAP_MS) {
            console.log(`📋 TÜBİTAK: ${(gap / 1000).toFixed(0)}s boşluk algılandı → yeni dosya oluşturuluyor`);
        }
        initTubitakSession(now);
    }

    tubitakSession.lastDataTime = now.getTime();
    const elapsedMs = now.getTime() - tubitakSession.startTime;

    // hiz_kmh
    const hiz = data.h != null ? data.h : '';
    // T_bat_C: t1, t2, t3 arasından en yüksek değer
    const temps = [data.t1, data.t2, data.t3].map(v => parseFloat(v)).filter(v => !isNaN(v));
    const tBat = temps.length > 0 ? Math.max(...temps) : '';
    // T_tank_C: şimdilik yakıt hücresi harici sıcaklık (fet)
    const tTank = data.fet != null ? data.fet : '';
    // V_bat_V: toplam batarya gerilimi
    const vBat = data.bv != null ? data.bv : '';
    // kalan_enerji_Wh
    const kalan = data.ke != null ? data.ke : '';

    tubitakSession.pending.push(`${elapsedMs};${hiz};${tBat};${tTank};${vBat};${kalan}`);
    flushTubitakData();
}

// TÜBİTAK verisini dosyaya yaz (asenkron)
let isFlushingTubitak = false;

async function flushTubitakData(force = false) {
    if (tubitakSession.pending.length === 0) return;
    if (!force && tubitakSession.pending.length < TUBITAK_FLUSH_THRESHOLD) return; // Debounce
    if (isFlushingTubitak) return;
    isFlushingTubitak = true;

    const rows = [...tubitakSession.pending];
    tubitakSession.pending = [];

    const filePath = path.join(TUBITAK_DIR, tubitakSession.fileName);
    try {
        const content = rows.join('\n') + '\n';
        await fsPromises.appendFile(filePath, content, 'utf8');
        if (state.dataCounter % 10 === 0) {
            console.log(`📋 TÜBİTAK: ${rows.length} kayıt yazıldı → ${tubitakSession.fileName}`);
        }
    } catch (err) {
        tubitakSession.pending = [...rows, ...tubitakSession.pending];
    } finally {
        isFlushingTubitak = false;
    }
}

// TÜBİTAK dosyalarını listele
function getTubitakFiles() {
    if (!fs.existsSync(TUBITAK_DIR)) return [];
    return fs.readdirSync(TUBITAK_DIR)
        .filter(f => f.startsWith('tubitak_') && f.endsWith('.csv'))
        .map(f => {
            const filePath = path.join(TUBITAK_DIR, f);
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim());
            const dataCount = Math.max(0, lines.length - 1);
            // Dosya adından tarih/saat çıkar: tubitak_DD-MM-YYYY_HH-MM-SS.csv
            const match = f.match(/tubitak_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})\.csv/);
            let dateStr = '', timeStr = '';
            if (match) {
                dateStr = match[1];
                timeStr = match[2].replace(/-/g, ':');
            }
            return { fileName: f, date: dateStr, time: timeStr, dataCount, fileSize: stats.size, lastModified: stats.mtime };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

module.exports = { tubitakSession, recordTubitakData, flushTubitakData, getTubitakFiles };
