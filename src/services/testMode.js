// ============================================
// TEST MODU SERVİSİ
// Test kaydı başlat/durdur/duraklat ve test CSV dosya yönetimi
// ============================================
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('../config');
const state = require('../state');
const { timestampedFileName, formatDuration } = require('../utils/helpers');
const { getActiveVehicle } = require('./systemSettings');

const { TEST_DIR, TEST_CSV_HEADERS, URBAN_TEST_CSV_HEADERS, FLUSH_THRESHOLD } = config;

// Test modu durumu
const testMode = {
    active: false,
    stopping: false,      // Son satırlar yazılırken yeni veri kabul edilmez.
    startTime: null,
    testName: null,
    vehicle: null,        // 'proto' | 'urban' — test başlarken aktif araç sabitlenir
    pendingTestData: [],
    paused: false,       // Duraklatılmış mı?
    pausedAt: null,      // Duraklatma zamanı (ms, epoch)
    pausedElapsed: 0     // Toplam duraklatılmış süre (ms)
};

// Dosya varlık cache'i — senkron fs.existsSync çağrısını önler
const _testFileExists = {};

// Test başlat — dosya adı ve başlangıç zamanı ayarlanır
function startTest() {
    const now = new Date();
    const vehicle = getActiveVehicle();
    testMode.active = true;
    testMode.startTime = now.getTime();
    testMode.vehicle = vehicle;
    testMode.testName = timestampedFileName(`test_${vehicle}`, now);
    testMode.pendingTestData = [];
    return { testName: testMode.testName, startTime: now.toISOString(), vehicle };
}

// Eşzamanlı durdurma istekleri aynı yazma işleminin tamamlanmasını bekler.
let stoppingTest = null;

// Test durdur — devam eden yazmayı ve bekleyen son satırları tamamlar.
function stopTest() {
    if (stoppingTest) return stoppingTest;
    testMode.stopping = true;
    stoppingTest = finishTest().finally(() => {
        testMode.stopping = false;
        stoppingTest = null;
    });
    return stoppingTest;
}

async function finishTest() {
    // Süre ve dosya kimliği durdurma anına aittir; disk beklemesi süreye eklenmez.
    const duration = Date.now() - testMode.startTime;
    const testName = testMode.testName;
    const realDuration = duration - testMode.pausedElapsed;
    const vehicle = testMode.vehicle;

    // active, dosya adı ve kuyruk yazma bitmeden sıfırlanmamalı. Bu sırada
    // yeni test/araç değişikliği de mevcut active kontrolüyle engellenir.
    if (!await flushTestDataToFile()) {
        throw new Error('Test verileri dosyaya kaydedilemedi; kayıt kapatılmadı. Tekrar durdurmayı deneyin.');
    }

    // Test dosyasındaki veri sayısını al
    const filePath = path.join(TEST_DIR, testName);
    let dataCount = 0;
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        dataCount = Math.max(0, lines.length - 1);
    }

    testMode.active = false;
    testMode.startTime = null;
    testMode.testName = null;
    testMode.vehicle = null;
    testMode.pendingTestData = [];
    testMode.paused = false;
    testMode.pausedAt = null;
    testMode.pausedElapsed = 0;

    return { testName, realDuration, dataCount, vehicle };
}

// Testi duraklat
function pauseTest() {
    testMode.paused = true;
    testMode.pausedAt = Date.now();

    // Bekleyen verileri hemen kaydet
    if (testMode.pendingTestData.length > 0) {
        flushTestDataToFile();
    }
}

// Testi devam ettir — duraklatılmış süreyi birikimli olarak ekler
function resumeTest() {
    const pauseDuration = Date.now() - testMode.pausedAt;
    testMode.pausedElapsed += pauseDuration;
    testMode.paused = false;
    testMode.pausedAt = null;
    return pauseDuration;
}

// Gelen telemetri verisini test kaydına ekle (aktif ve duraklatılmamışsa)
function recordTestData(dataWithTimestamp, now) {
    if (!testMode.active || testMode.stopping || testMode.paused || !testMode.startTime) return;

    // Gerçek geçen süre = toplam süre - duraklatılmış süre
    const elapsedMs = (now.getTime() - testMode.startTime) - testMode.pausedElapsed;

    testMode.pendingTestData.push({
        test_time: formatDuration(elapsedMs),
        ...dataWithTimestamp
    });

    if (testMode.pendingTestData.length >= FLUSH_THRESHOLD) {
        flushTestDataToFile();
    }
}

// Test verilerini dosyaya yaz - ASENKRON (non-blocking)
let activeTestFlush = null;

async function flushTestDataToFile() {
    // Kuyruk boş olsa bile, diske alınmış ama henüz tamamlanmamış parti beklenir.
    while (activeTestFlush) await activeTestFlush;
    if (!testMode.active || testMode.pendingTestData.length === 0) return true;

    const operation = writePendingTestData();
    activeTestFlush = operation;
    try {
        return await operation;
    } finally {
        if (activeTestFlush === operation) activeTestFlush = null;
    }
}

async function writePendingTestData() {
    const dataToWrite = [...testMode.pendingTestData];
    testMode.pendingTestData = [];

    const { testName, vehicle } = testMode;
    const filePath = path.join(TEST_DIR, testName);
    const csvHeaders = vehicle === 'urban' ? URBAN_TEST_CSV_HEADERS : TEST_CSV_HEADERS;

    try {
        // Dosya varlık cache'i — senkron existsSync yerine
        let fileExists = _testFileExists[testName];
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
            csvContent = '\uFEFF' + csvHeaders.join(';') + '\n';
        }

        dataToWrite.forEach(data => {
            const row = csvHeaders.map(h => data[h] !== undefined && data[h] !== null ? data[h] : '');
            csvContent += row.join(';') + '\n';
        });

        // ASENKRON dosya yazma
        await fsPromises.appendFile(filePath, csvContent, 'utf8');
        _testFileExists[testName] = true;
        const counter = vehicle === 'urban' ? state.urbanDataCounter : state.dataCounter;
        if (counter % 10 === 0) {
            console.log(`${dataToWrite.length} test verisi kaydedildi: ${testName}`);
        }
        return true;
    } catch (error) {
        testMode.pendingTestData = [...dataToWrite, ...testMode.pendingTestData];
        return false;
    }
}

function detectTestVehicle(headers, fileName = '') {
    const urbanFields = new Set([
        'T_tank_C', 'max_temperature', 'mv', 'mc', 'mw',
        'ischarging', 'controller_speed', 'error_code'
    ]);
    if (headers.some(header => urbanFields.has(header))) return 'urban';
    return fileName.startsWith('test_urban_') ? 'urban' : 'proto';
}

// Test dosyalarının listesini al (ASENKRON — event loop bloklamaz)
async function getTestFiles() {
    try {
        await fsPromises.access(TEST_DIR);
    } catch {
        return [];
    }

    const allFiles = await fsPromises.readdir(TEST_DIR);
    const csvFiles = allFiles.filter(f => f.endsWith('.csv'));

    const files = [];
    for (const f of csvFiles) {
        try {
            const filePath = path.join(TEST_DIR, f);
            const stats = await fsPromises.stat(filePath);
            const content = await fsPromises.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            const dataCount = Math.max(0, lines.length - 1);
            const headers = lines.length > 0
                ? lines[0].replace('\uFEFF', '').split(';').map(header => header.trim())
                : [];
            const vehicle = detectTestVehicle(headers, f);

            // Dosya içeriğindeki ilk veri satırından tarih ve saat bilgisini çıkar
            let dateStr = '', timeStr = '';
            if (lines.length > 1) {
                const firstDataRow = lines[1].split(';');
                const dateIdx = headers.indexOf('date');
                const timeIdx = headers.indexOf('time');
                if (dateIdx !== -1 && timeIdx !== -1 && firstDataRow[dateIdx] && firstDataRow[timeIdx]) {
                    dateStr = firstDataRow[dateIdx].trim();
                    timeStr = firstDataRow[timeIdx].trim();
                }
            }

            files.push({
                fileName: f,
                vehicle,
                date: dateStr,
                time: timeStr,
                dataCount: dataCount,
                fileSize: stats.size,
                lastModified: stats.mtime
            });
        } catch {
            // Hatalı dosyaları atla
        }
    }

    files.sort((a, b) => {
        const parseDateTime = (d, t) => {
            if (!d || !t) return 0;
            return new Date(`${d}T${t}`).getTime();
        };
        return parseDateTime(b.date, b.time) - parseDateTime(a.date, a.time);
    });

    return files;
}

module.exports = {
    testMode,
    startTest,
    stopTest,
    pauseTest,
    resumeTest,
    recordTestData,
    flushTestDataToFile,
    detectTestVehicle,
    getTestFiles
};
