// ============================================
// TÜBİTAK KAYIT SİSTEMİ
// Yalnızca URBAN telemetrisi kaydedilir. HTTP: s=1 yeni dosya, s=0 devam.
// MQTT: ilk veri veya 60s veri boşluğu yeni dosya başlatır.
// Başlık: zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_C;kalan_enerji_Wh
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
    pending: []         // { fileName, row } — satır kendi dosyasına bağlı kalır
};

// Başlık ve tetikleyen paketin ilk satırı birlikte yazılır. Aynı milisaniyede
// tekrar s=1 gelse bile wx + sıra numarası mevcut dosyanın üzerine yazmaz.
function initTubitakSession(data, now) {
    const base = timestampedFileName('tubitak', now).replace(/\.csv$/, '')
        + '_' + String(now.getMilliseconds()).padStart(3, '0');
    const content = '\uFEFF' + TUBITAK_HEADERS + '\n' + buildTubitakRow(data, 0) + '\n';
    for (let sequence = 1; ; sequence++) {
        const fileName = `${base}${sequence === 1 ? '' : `_${sequence}`}.csv`;
        try {
            fs.writeFileSync(path.join(TUBITAK_DIR, fileName), content, { encoding: 'utf8', flag: 'wx' });
            tubitakSession.startTime = now.getTime();
            tubitakSession.fileName = fileName;
            // Eski dosyaların bekleyen satırlarını temizleme.
            console.log(`📋 TÜBİTAK kayıt dosyası oluşturuldu: ${fileName}`);
            return;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
}

function parseTubitakFileName(fileName) {
    const match = /^tubitak_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})(?:_(\d{3})(?:_(\d+))?)?\.csv$/.exec(fileName);
    if (!match) return null;
    const [day, month, year] = match[1].split('-').map(Number);
    const [hour, minute, second] = match[2].split('-').map(Number);
    const start = new Date(year, month - 1, day, hour, minute, second, Number(match[3] || 0));
    if (timestampedFileName('tubitak', start) !== `tubitak_${match[1]}_${match[2]}.csv`) return null;
    return {
        fileName, startTime: start.getTime(), sequence: Number(match[4] || 1),
        hasMilliseconds: match[3] !== undefined,
        date: match[1], time: match[2].replace(/-/g, ':')
    };
}

// HTTP s=0, sunucu yeniden başlasa da en son açılan geçerli kayda devam eder.
// Son yazılma zamanı kullanılmaz: eski dosyanın geciken yazması onu yeni yapmaz.
function restoreLatestTubitakSession() {
    if (!fs.existsSync(TUBITAK_DIR)) return;
    const candidates = fs.readdirSync(TUBITAK_DIR).map(parseTubitakFileName).filter(Boolean)
        .sort((a, b) => b.startTime - a.startTime || b.sequence - a.sequence
            || Number(b.hasMilliseconds) - Number(a.hasMilliseconds));
    for (const candidate of candidates) {
        let descriptor;
        try {
            descriptor = fs.openSync(path.join(TUBITAK_DIR, candidate.fileName), 'r');
            if (!fs.fstatSync(descriptor).isFile()) continue;
            const buffer = Buffer.alloc(1024);
            const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
            const header = buffer.toString('utf8', 0, length).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
            if (header !== TUBITAK_HEADERS) continue;
            tubitakSession.fileName = candidate.fileName;
            tubitakSession.startTime = candidate.startTime;
            return;
        } catch {
            // Silinmiş/bozuk dosyayı atla; uygun dosya yoksa ilk veriyle oluşturulur.
        } finally {
            if (descriptor !== undefined) fs.closeSync(descriptor);
        }
    }
}

function buildTubitakRow(data, elapsedMs) {
    // hiz_kmh
    const hiz = data.h != null ? data.h : '';
    // T_bat_C: yeni URBAN string'indeki batarya paketi maksimum sıcaklığı
    const tBat = data.max_temperature != null ? data.max_temperature : '';
    // T_tank_C: URBAN tank sıcaklığı
    const tTank = data.T_tank_C != null ? data.T_tank_C : '';
    // V_bat_C: istenen CSV başlık adı; değer yine toplam batarya gerilimi (bv).
    const vBat = data.bv != null ? data.bv : '';
    // kalan_enerji_Wh
    const kalan = data.ke != null ? data.ke : '';

    return `${elapsedMs};${hiz};${tBat};${tTank};${vBat};${kalan}`;
}

// Gelen URBAN telemetri verisini TÜBİTAK formatında kaydet.
// HTTP'de her s=1 yeni kayıt açar; s=0 (veya eksik s) boşluk olsa da devam eder.
// s bir telemetri alanı değildir; yalnızca HTTP kayıt kontrolü olarak iletilir.
function recordTubitakData(data, now, { source = 'MQTT', startNewFile = false } = {}) {
    const isHttp = source === 'HTTP';
    if (!tubitakSession.fileName || !fs.existsSync(path.join(TUBITAK_DIR, tubitakSession.fileName))) {
        tubitakSession.fileName = null;
        tubitakSession.startTime = null;
        if (isHttp && !startNewFile) restoreLatestTubitakSession();
    }
    const gap = tubitakSession.lastDataTime !== null
        ? (now.getTime() - tubitakSession.lastDataTime)
        : 0;
    const needsNewFile = (isHttp && startNewFile) || tubitakSession.startTime === null
        || (!isHttp && gap > TUBITAK_GAP_MS);
    if (needsNewFile) {
        initTubitakSession(data, now);
    } else {
        const elapsedMs = Math.max(0, now.getTime() - tubitakSession.startTime);
        tubitakSession.pending.push({ fileName: tubitakSession.fileName, row: buildTubitakRow(data, elapsedMs) });
    }

    tubitakSession.lastDataTime = now.getTime();
    return flushTubitakData(isHttp || needsNewFile);
}

// Tek yazıcı: dosya değişse de bekleyen/uçuş halindeki satırlar kendi hedefinde kalır.
let activeFlush = null;

async function flushTubitakData(force = false) {
    while (activeFlush) await activeFlush;
    if (tubitakSession.pending.length === 0) return;
    if (!force && tubitakSession.pending.length < TUBITAK_FLUSH_THRESHOLD) return; // Debounce
    const operation = writePendingRows();
    activeFlush = operation;
    let success;
    try {
        success = await operation;
    } finally {
        if (activeFlush === operation) activeFlush = null;
    }
    if (success && force && tubitakSession.pending.length > 0) return flushTubitakData(true);
    return success;
}

async function writePendingRows() {
    const batches = [];
    for (const entry of tubitakSession.pending) {
        if (batches.at(-1)?.fileName !== entry.fileName) batches.push({ fileName: entry.fileName, entries: [] });
        batches.at(-1).entries.push(entry);
    }
    tubitakSession.pending = [];

    for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        try {
            await fsPromises.appendFile(path.join(TUBITAK_DIR, batch.fileName), batch.entries.map(entry => entry.row).join('\n') + '\n', 'utf8');
            if (state.urbanDataCounter % 10 === 0) {
                console.log(`📋 TÜBİTAK: ${batch.entries.length} kayıt yazıldı → ${batch.fileName}`);
            }
        } catch (error) {
            // Yalnızca henüz yazılmamış satırları, özgün dosya adlarıyla geri koy.
            tubitakSession.pending = [...batches.slice(index).flatMap(batch => batch.entries), ...tubitakSession.pending];
            console.error(`TÜBİTAK kayıt yazılamadı (${batch.fileName}): ${error.message}`);
            return false;
        }
    }
    return true;
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
            // Eski adları ve yeni milisaniye/çakışma son eklerini birlikte oku.
            const parsedName = parseTubitakFileName(f);
            const dateStr = parsedName?.date || '';
            const timeStr = parsedName?.time || '';
            return { fileName: f, date: dateStr, time: timeStr, dataCount, fileSize: stats.size, lastModified: stats.mtime };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

module.exports = { tubitakSession, buildTubitakRow, recordTubitakData, flushTubitakData, getTubitakFiles };
