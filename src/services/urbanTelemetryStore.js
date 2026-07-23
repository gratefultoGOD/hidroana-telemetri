// ============================================
// URBAN ARACI GÜNLÜK TELEMETRİ DEPOLAMA SERVİSİ
// telemetryStore.js ile aynı mantık, URBAN aracının kendi
// veri dizini/CSV başlıkları/alan kümesiyle çalışır.
// ============================================
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('../config');
const state = require('../state');
const { getDailyFileName } = require('../utils/helpers');

const { URBAN_DATA_DIR: DATA_DIR, URBAN_CSV_HEADERS: CSV_HEADERS, URBAN_NUMERIC_FIELDS: NUMERIC_FIELDS, FLUSH_THRESHOLD, RECENT_DATA_WINDOW } = config;
const FILE_SUFFIX = '_urban_verileri.csv';

let pendingData = []; // Dosyaya yazılmayı bekleyen veriler

// Dosya varlık cache'leri — senkron fs.existsSync çağrısını önler
let _dailyCsvExists = false;
let _dailyCsvFileName = null;

// Son 15 saniyenin verilerini bellekte tut (ortalama hesaplama için)
let recentData = [];

// Running Average değişkenleri
let dailyAverages = {};
let dailyAveragesCount = 0;
let currentDailyFile = getDailyFileName(new Date(), FILE_SUFFIX);
NUMERIC_FIELDS.forEach(f => dailyAverages[f] = 0);

// Available days count cache — asenkron güncellenir, event loop bloklamaz
let _availableDaysCount = 0;

async function updateAvailableDaysCount() {
    try {
        const files = await fsPromises.readdir(DATA_DIR);
        _availableDaysCount = files.filter(f => f.endsWith(FILE_SUFFIX)).length;
    } catch {
        _availableDaysCount = 0;
    }
}

// Başlangıçta günlük ortalamaları dosyadan hesapla
function initDailyAverages() {
    const filePath = path.join(DATA_DIR, currentDailyFile);
    dailyAveragesCount = 0;
    NUMERIC_FIELDS.forEach(f => dailyAverages[f] = 0);

    if (!fs.existsSync(filePath)) return;

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length <= 1) return;

        const headers = lines[0].replace('\uFEFF', '').split(';');
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(';');
            dailyAveragesCount++;

            NUMERIC_FIELDS.forEach(field => {
                const index = headers.indexOf(field);
                if (index !== -1) {
                    const val = parseFloat(values[index]);
                    if (!isNaN(val)) {
                        dailyAverages[field] += (val - dailyAverages[field]) / dailyAveragesCount;
                    }
                }
            });
        }
    } catch (e) {
        // Günlük ortalamalar hesaplanamadı — sıfırdan devam
    }
}

// Gün değişimi kontrolü — gün değiştiyse running average sıfırlanır
function checkDayRollover(now) {
    const newDailyFile = getDailyFileName(now, FILE_SUFFIX);
    if (newDailyFile !== currentDailyFile) {
        currentDailyFile = newDailyFile;
        dailyAveragesCount = 0;
        NUMERIC_FIELDS.forEach(f => dailyAverages[f] = 0);
    }
}

// Yeni veriyi running average'a ekle
function updateRunningAverages(data) {
    dailyAveragesCount++;
    NUMERIC_FIELDS.forEach(field => {
        const val = parseFloat(data[field]);
        if (!isNaN(val)) {
            dailyAverages[field] += (val - dailyAverages[field]) / dailyAveragesCount;
        }
    });
}

// Veriyi bellek pencerelerine ve yazma kuyruğuna ekle
function enqueueData(data) {
    recentData.push(data);
    pendingData.push(data);

    // N veri birikince dosyaya yaz
    if (pendingData.length >= FLUSH_THRESHOLD) {
        flushDataToFile();
    }
}

// Dosyaya veri yaz - ASENKRON (non-blocking)
let isFlushingData = false; // Eşzamanlı yazma kontrolü

async function flushDataToFile() {
    if (pendingData.length === 0) return;
    if (isFlushingData) return; // Zaten yazılıyorsa bekle

    isFlushingData = true;

    const dataToWrite = [...pendingData]; // Kopyasını al
    pendingData = []; // Hemen temizle (yeni veriler birikebilir)

    const fileName = getDailyFileName(new Date(), FILE_SUFFIX);
    const filePath = path.join(DATA_DIR, fileName);

    try {
        // Dosya varlık cache'i — senkron existsSync yerine bellekten kontrol
        let fileExists = (_dailyCsvFileName === fileName && _dailyCsvExists);
        if (!fileExists) {
            try {
                await fsPromises.access(filePath);
                fileExists = true;
            } catch {
                fileExists = false;
            }
        }

        let csvContent = '';
        if (!fileExists) {
            csvContent = '\uFEFF' + CSV_HEADERS.join(';') + '\n';
        }

        // Verileri CSV formatına çevir
        dataToWrite.forEach(data => {
            const row = CSV_HEADERS.map(h => data[h] !== undefined && data[h] !== null ? data[h] : '');
            csvContent += row.join(';') + '\n';
        });

        // Dosyaya ASENKRON ekle - event loop'u bloklamaz
        await fsPromises.appendFile(filePath, csvContent, 'utf8');
        _dailyCsvExists = true;
        _dailyCsvFileName = fileName;
        if (state.urbanDataCounter % 10 === 0) {
            console.log(`💾 [URBAN] ${dataToWrite.length} veri dosyaya yazıldı: ${fileName}`);
        }
    } catch (error) {
        // Hata durumunda verileri geri ekle
        pendingData = [...dataToWrite, ...pendingData];
    } finally {
        isFlushingData = false;
    }
}

// Ortalama hesaplama fonksiyonu (running avg + son 15 saniye)
function calculateAverages() {
    const now = Date.now();
    const cutoff = now - RECENT_DATA_WINDOW;

    // Eski verileri temizle
    recentData = recentData.filter(d => d.timestamp >= cutoff);

    const averages = {
        allTime: {}, // Running average yöntemiyle hesaplanan günlük ortalama
        last15Seconds: {},
        allTimeCount: dailyAveragesCount, // Bellekte tutulan sayaç — dosya okumaz
        last15SecondsCount: recentData.length
    };

    NUMERIC_FIELDS.forEach(field => {
        // Son 15 saniye ortalaması
        const recentValues = recentData.map(d => parseFloat(d[field])).filter(v => !isNaN(v));
        averages.last15Seconds[field] = recentValues.length > 0
            ? (recentValues.reduce((a, b) => a + b, 0) / recentValues.length).toFixed(2)
            : null;

        // Running average genel ortalama
        averages.allTime[field] = dailyAveragesCount > 0 ? dailyAverages[field].toFixed(2) : null;
    });

    return averages;
}

// Tüm günlerin listesini al (ASENKRON — event loop bloklamaz)
async function getAvailableDays() {
    try {
        await fsPromises.access(DATA_DIR);
    } catch {
        return [];
    }

    const allFiles = await fsPromises.readdir(DATA_DIR);
    const csvFiles = allFiles.filter(f => f.endsWith(FILE_SUFFIX));

    const files = [];
    for (const f of csvFiles) {
        try {
            const filePath = path.join(DATA_DIR, f);
            const stats = await fsPromises.stat(filePath);
            const content = await fsPromises.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            files.push({
                fileName: f,
                date: f.replace(FILE_SUFFIX, ''),
                dataCount: Math.max(0, lines.length - 1),
                fileSize: stats.size,
                lastModified: stats.mtime
            });
        } catch {
            // Hatalı dosyaları atla
        }
    }

    files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    return files;
}

// Bugünün verilerini temizle — silinen kayıt sayısını döndürür
function clearTodayData() {
    const fileName = getDailyFileName(new Date(), FILE_SUFFIX);
    const filePath = path.join(DATA_DIR, fileName);

    let clearedCount = pendingData.length;
    pendingData = [];
    recentData = [];

    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        clearedCount += Math.max(0, lines.length - 1);
        fs.unlinkSync(filePath);
    }
    return clearedCount;
}

module.exports = {
    initDailyAverages,
    checkDayRollover,
    updateRunningAverages,
    enqueueData,
    flushDataToFile,
    calculateAverages,
    getAvailableDays,
    updateAvailableDaysCount,
    clearTodayData,
    getPendingCount: () => pendingData.length,
    getDailyAveragesCount: () => dailyAveragesCount,
    getDailyAverages: () => dailyAverages,
    getAvailableDaysCount: () => _availableDaysCount,
    FILE_SUFFIX
};
