const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;  // Asenkron dosya işlemleri için
const mqtt = require('mqtt');
const favicon = require('serve-favicon');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// VERI KAYNAĞI AYARLARI (MQTT veya HTTP)
// ============================================
let DATA_SOURCE = process.env.DATA_SOURCE || 'MQTT'; // 'MQTT' veya 'HTTP'

// MQTT Configuration
const MQTT_BROKER_URL = 'mqtt://213.142.148.28:1883';
const MQTT_OPTIONS = {
    username: 'hidroana',
    password: 'hidro2626'
};

/*
const MQTT_BROKER_URL = 'mqtts://7b53477c154b4e65a96dbaa8ca717dfc.s1.eu.hivemq.cloud';
const MQTT_OPTIONS = {
    username: 'admin',
    password: 'Admin123'
};*/
const MQTT_TOPIC = 'data';
const MQTT_TAKE = 'take';

// HTTP Configuration (Araçtan veri alma - araç bize POST yapar)

// Son alınan telemetri verisi
let latestTelemetryData = null;
let key = '066c4e702e'
let dataCounter = 0; // Her yeni veri geldiğinde artar

// ============================================
// FLOW VERİSİ BUFFER (flow topic'inden gelen veriler)
// ============================================
// Flow sensörü daha hızlı veri gönderir; normal veriyi beklemesi için
// gelen her flow değeri timestamp ile birlikte buffer'da tutulur.
let flowBuffer = [];           // { value: <number|string>, timestamp: <ms> }
const FLOW_MATCH_WINDOW = 5000; // Eşleştirme penceresi: 5 saniye
const FLOW_BUFFER_MAX = 200;    // Maksimum buffer boyutu
let hasReceivedFlowData = false; // Hiç flow verisi alındı mı?

// Flow verisini buffer'a ekle — format: "anlık_flow*toplam_flow"
function addFlowToBuffer(rawValue, timestamp) {
    hasReceivedFlowData = true;
    // Formatı parse et: "11.27*0.123450" → { instantFlow: 11.27, totalFlow: 0.12345 }
    let instantFlow = null;
    let totalFlow = null;
    if (typeof rawValue === 'string' && rawValue.includes('*')) {
        const parts = rawValue.split('*');
        const a = parseFloat(parts[0]);
        const b = parseFloat(parts[1]);
        if (!isNaN(a)) instantFlow = a;
        if (!isNaN(b)) totalFlow = b;
    } else {
        // Eski tek değer formatı için geri uyumluluk
        const v = parseFloat(rawValue);
        if (!isNaN(v)) instantFlow = v;
    }
    flowBuffer.push({ instantFlow, totalFlow, timestamp });
    if (flowBuffer.length > FLOW_BUFFER_MAX) {
        flowBuffer.shift();
    }
    // Pencere dışındaki eski verileri temizle
    const cutoff = timestamp - FLOW_MATCH_WINDOW;
    flowBuffer = flowBuffer.filter(f => f.timestamp >= cutoff);
}

// Normal veri timestamp'ına en yakın flow verisini bul
// Döndürülen değer: { instantFlow, totalFlow } veya null
function findBestFlowMatch(dataTimestamp) {
    if (!hasReceivedFlowData || flowBuffer.length === 0) return null;

    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < flowBuffer.length; i++) {
        const diff = Math.abs(flowBuffer[i].timestamp - dataTimestamp);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }

    // Pencere içinde değilse eşleşme yok
    if (bestIdx === -1 || bestDiff > FLOW_MATCH_WINDOW) return null;

    const { instantFlow, totalFlow } = flowBuffer[bestIdx];
    return { instantFlow, totalFlow };
}

// ============================================
// SSE (Server-Sent Events) CLIENT YÖNETİMİ
// ============================================
let sseClients = new Set(); // Bağlı SSE client'ları

// SSE broadcast - yeni veri geldiğinde tüm client'lara gönder
// Backpressure-aware: yavaş client'lar event loop'u bloklayamaz
function broadcastToClients(data) {
    if (sseClients.size === 0) return;

    const message = `data: ${JSON.stringify(data)}\n\n`;

    sseClients.forEach(client => {
        try {
            // res.write() false döndürürse TCP buffer dolu demektir
            // Bu durumda client yavaş — bırakılmalı, yoksa event loop bloklanır
            const ok = client.write(message);
            if (!ok) {
                // Yavaş client — bir şans daha ver ama drain'i bekle
                // Eğer drain 5 saniye içinde gelmezse bağlantıyı kes
                if (!client._sseSlowWarned) {
                    client._sseSlowWarned = true;
                    const drainTimeout = setTimeout(() => {
                        //console.log('⚠️ SSE yavaş client bağlantısı kesiliyor (drain timeout)');
                        try { client.end(); } catch (e) { /* ignore */ }
                        sseClients.delete(client);
                    }, 5000);

                    client.once('drain', () => {
                        clearTimeout(drainTimeout);
                        client._sseSlowWarned = false;
                    });
                }
            }
        } catch (error) {
            //console.error('SSE client yazma hatası:', error);
            sseClients.delete(client);
        }
    });

    // SSE broadcast logu throttle — her 10 veride 1
    if (dataCounter % 10 === 0) {
        //console.log(`📡 SSE broadcast: ${sseClients.size} client'a veri gönderildi`);
    }
}

// CSV dosya ayarları
const DATA_DIR = path.join(__dirname, 'telemetry_data');
const TEST_DIR = path.join(__dirname, 'test_data');
const SECTORS_DIR = path.join(__dirname, 'sectors_data');
const RACES_DIR = path.join(__dirname, 'races_data');
const TUBITAK_DIR = path.join(__dirname, 'tubitak_data');
let pendingData = []; // Dosyaya yazılmayı bekleyen veriler
const FLUSH_THRESHOLD = 5; // 5 veri birikince dosyaya yaz (event loop koruması)
const TUBITAK_FLUSH_THRESHOLD = 5; // TÜBİTAK verileri için de aynı

// Dosya varlık cache'leri — senkron fs.existsSync çağrısını önler
let _dailyCsvExists = false;
let _dailyCsvFileName = null;
let _testFileExists = {};

// Sectors dizinini oluştur
if (!fs.existsSync(SECTORS_DIR)) {
    fs.mkdirSync(SECTORS_DIR, { recursive: true });
}

// Races dizinini oluştur
if (!fs.existsSync(RACES_DIR)) {
    fs.mkdirSync(RACES_DIR, { recursive: true });
}

// TÜBİTAK dizinini oluştur
if (!fs.existsSync(TUBITAK_DIR)) {
    fs.mkdirSync(TUBITAK_DIR, { recursive: true });
}

// ============================================
// LAP/RACE YÖNETİMİ (In-Memory State)
// ============================================
let lapState = {
    active: false,
    startTime: null,
    startJwh: null,
    laps: [],
    currentJwh: 0,
    savedFileName: null   // Stop sırasında kaydedildi mi?
};

let lapSSEClients = new Set(); // Lap SSE client'ları

// ============================================
// REALTIME SECTOR SSE CLIENT YÖNETİMİ
// ============================================
let raceSectorClients = new Set(); // /race sayfasına sector güncellemesi SSE client'ları

// Son realtime sector verisini sakla (yeni bağlanan client'a hemen gönder)
let lastRealtimeSectorPayload = null;

// Realtime sector SSE broadcast
function broadcastSectorUpdate(payload) {
    lastRealtimeSectorPayload = payload;
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    raceSectorClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            //console.error('Race Sector SSE client yazma hatası:', error);
            raceSectorClients.delete(client);
        }
    });
    if (raceSectorClients.size > 0) {
        //console.log(`🏁 Realtime sector broadcast: ${raceSectorClients.size} client'a gönderildi`);
    }
}

// Lap SSE broadcast
function broadcastLapState() {
    const data = {
        type: 'lap_update',
        active: lapState.active,
        startTime: lapState.startTime,
        startJwh: lapState.startJwh,
        laps: lapState.laps,
        currentJwh: lapState.currentJwh,
        serverTime: Date.now()
    };
    const message = `data: ${JSON.stringify(data)}\n\n`;

    lapSSEClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            //console.error('Lap SSE client yazma hatası:', error);
            lapSSEClients.delete(client);
        }
    });

    if (lapSSEClients.size > 0) {
        //console.log(`🏁 Lap SSE broadcast: ${lapSSEClients.size} client'a gönderildi`);
    }
}

// Yarış verisini dosyaya kaydet (reset veya stop sırasında)
function saveRaceToFile() {
    if (lapState.laps.length === 0) return null;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fileName = `race_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.csv`;
    const filePath = path.join(RACES_DIR, fileName);

    // CSV oluştur
    let csv = '\uFEFF'; // BOM
    csv += 'Tur No;Başlangıç (ms);Tur Süresi (ms);Tur Wh;Toplam Wh\n';

    lapState.laps.forEach(lap => {
        const startMs = lap.startTime - lapState.startTime;
        csv += [
            lap.lapNum,
            startMs,
            lap.lapDuration,
            lap.lapJwh.toFixed(3),
            lap.endJwh.toFixed(3)
        ].join(';') + '\n';
    });

    // Metadata satırı
    const totalDuration = lapState.laps.length > 0
        ? lapState.laps[lapState.laps.length - 1].endTime - lapState.startTime
        : 0;
    const totalJwh = lapState.laps.length > 0
        ? lapState.laps[lapState.laps.length - 1].endJwh - lapState.startJwh
        : 0;

    // Metadata JSON olarak ayrı dosyaya kaydet
    const metaPath = filePath.replace('.csv', '.json');
    const meta = {
        fileName: fileName,
        savedAt: now.toISOString(),
        startTime: lapState.startTime,
        lapCount: lapState.laps.length,
        totalDuration: totalDuration,
        totalJwh: totalJwh,
        startJwh: lapState.startJwh
    };

    /* fs.writeFileSync(); */
    /* fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); */
    //console.log(`📁 Yarış kaydedildi: ${fileName} (${lapState.laps.length} tur)`);
    return fileName;
}

// Test modu ayarları
let testMode = {
    active: false,
    startTime: null,
    testName: null,
    pendingTestData: [],
    paused: false,       // Duraklatılmış mı?
    pausedAt: null,      // Duraklatma zamanı (ms, epoch)
    pausedElapsed: 0     // Toplam duraklatılmış süre (ms)
};

// ============================================
// TÜBİTAK KAYIT SİSTEMİ
// ============================================
// Her server başlatmasında eşsiz bir dosya oluşturulur.
// Her gelen veri anında kaydedilir.
// Başlık: zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_V;kalan_enerji_Wh
const TUBITAK_HEADERS = 'zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_V;kalan_enerji_Wh';

let tubitakSession = {
    startTime: null,  // İlk veri alındığında set edilir (ms, epoch)
    lastDataTime: null, // Son veri alım zamanı (ms, epoch) — 60s gap kontrolü için
    fileName: null,   // Aktif TÜBİTAK dosyasının adı
    pending: []       // Yazılmayı bekleyen satırlar
};

// TÜBİTAK oturumunu başlat — now parametresi ile sıfır-zaman tutarsızlığı önlenir
function initTubitakSession(now) {
    const pad = n => String(n).padStart(2, '0');
    const fileName = `tubitak_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.csv`;

    tubitakSession.startTime = now.getTime(); // processIncomingData'daki now ile aynı
    tubitakSession.fileName = fileName;
    tubitakSession.pending = [];

    // Başlık satırını yaz
    const filePath = path.join(TUBITAK_DIR, fileName);
    fs.writeFileSync(filePath, '\uFEFF' + TUBITAK_HEADERS + '\n', 'utf8');
    //console.log(`📋 TÜBİTAK kayıt dosyası oluşturuldu: ${fileName}`);
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
        if (dataCounter % 10 === 0) {
            //console.log(`📋 TÜBİTAK: ${rows.length} kayıt yazıldı → ${tubitakSession.fileName}`);
        }
    } catch (err) {
        //console.error('TÜBİTAK dosya yazma hatası:', err);
        tubitakSession.pending = [...rows, ...tubitakSession.pending];
    } finally {
        isFlushingTubitak = false;
    }
}

// TÜBİTAK dosyalarını listele
function getTubitakFiles() {
    if (!false /* fs.existsSync() */) return [];
    return [] /* fs.readdirSync() */
        .filter(f => f.startsWith('tubitak_') && f.endsWith('.csv'))
        .map(f => {
            const filePath = path.join(TUBITAK_DIR, f);
            const stats = { size: 0, mtime: new Date() } /* fs.statSync() */;
            const content = '{}' /* fs.readFileSync() */;
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

// Data klasörlerini oluştur
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Günlük dosya adı oluştur (DD-MM-YYYY_verileri.csv)
function getDailyFileName(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}_verileri.csv`;
}

// CSV başlıkları
const CSV_HEADERS = ['date', 'time', 'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh', 'mt', 'watt', 'ppm', 'gx', 'gy', 'gz', 'ax', 'ay', 'az', 'flow', 'totalflow', 'gsmspeed', 'pitch', 'roll', 'yaw', 'driver_pot', 'direksiyon_angle', 'realInstantFlow', 'realTotalFlow'];

// CSV içeriğini XLSX buffer'a dönüştür (semicolon separated)
function csvToXlsxBuffer(csvContent, sheetName = 'Veri') {
    // BOM karakterini kaldır
    const cleanCsv = csvContent.replace(/^\uFEFF/, '');
    const lines = cleanCsv.split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;

    const rows = lines.map(line => {
        return line.split(';').map(cell => {
            const trimmed = cell.trim();
            // Sayısal değerleri number olarak dönüştür (date/time hariç)
            const num = Number(trimmed);
            if (trimmed !== '' && !isNaN(num) && !trimmed.includes(':') && !trimmed.includes('-')) {
                return num;
            }
            return trimmed;
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Dosyaya veri yaz - ASENKRON (non-blocking)
let isFlushingData = false;  // Eşzamanlı yazma kontrolü

async function flushDataToFile() {
    if (pendingData.length === 0) return;
    if (isFlushingData) return;  // Zaten yazılıyorsa bekle

    isFlushingData = true;

    const dataToWrite = [...pendingData];  // Kopyasını al
    pendingData = [];  // Hemen temizle (yeni veriler birikebilir)

    const fileName = getDailyFileName();
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
        if (dataCounter % 10 === 0) {
            //console.log(`💾 ${dataToWrite.length} veri dosyaya yazıldı: ${fileName}`);
        }
    } catch (error) {
        //console.error('❌ Dosya yazma hatası:', error);
        // Hata durumunda verileri geri ekle
        pendingData = [...dataToWrite, ...pendingData];
    } finally {
        isFlushingData = false;
    }
}

// Test verilerini dosyaya yaz
const TEST_CSV_HEADERS = ['test_time', 'date', 'time', 'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh', 'mt', 'watt', 'ppm', 'gx', 'gy', 'gz', 'ax', 'ay', 'az', 'flow', 'totalflow', 'gsmspeed', 'pitch', 'roll', 'yaw', 'driver_pot', 'direksiyon_angle', 'realInstantFlow', 'realTotalFlow'];

let isFlushingTestData = false;  // Eşzamanlı yazma kontrolü

async function flushTestDataToFile() {
    if (!testMode.active || testMode.pendingTestData.length === 0) return;
    if (isFlushingTestData) return;

    isFlushingTestData = true;

    const dataToWrite = [...testMode.pendingTestData];
    testMode.pendingTestData = [];

    const filePath = path.join(TEST_DIR, testMode.testName);

    try {
        // Dosya varlık cache'i — senkron existsSync yerine
        let fileExists = _testFileExists[testMode.testName];
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
            csvContent = '\uFEFF' + TEST_CSV_HEADERS.join(';') + '\n';
        }

        dataToWrite.forEach(data => {
            const row = TEST_CSV_HEADERS.map(h => data[h] !== undefined && data[h] !== null ? data[h] : '');
            csvContent += row.join(';') + '\n';
        });

        // ASENKRON dosya yazma
        await fsPromises.appendFile(filePath, csvContent, 'utf8');
        _testFileExists[testMode.testName] = true;
        if (dataCounter % 10 === 0) {
            //console.log(`${dataToWrite.length} test verisi kaydedildi: ${testMode.testName}`);
        }
    } catch (error) {
        //console.error('Test dosyası yazma hatası:', error);
        testMode.pendingTestData = [...dataToWrite, ...testMode.pendingTestData];
    } finally {
        isFlushingTestData = false;
    }
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

            // Dosya içeriğindeki ilk veri satırından tarih ve saat bilgisini çıkar
            let dateStr = '', timeStr = '';
            if (lines.length > 1) {
                const firstDataRow = lines[1].split(';');
                const headers = lines[0].replace('\uFEFF', '').split(';');
                const dateIdx = headers.indexOf('date');
                const timeIdx = headers.indexOf('time');
                if (dateIdx !== -1 && timeIdx !== -1 && firstDataRow[dateIdx] && firstDataRow[timeIdx]) {
                    dateStr = firstDataRow[dateIdx].trim();
                    timeStr = firstDataRow[timeIdx].trim();
                }
            }

            files.push({
                fileName: f,
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

// Mevcut günün veri sayısını al
function getTodayDataCount() {
    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) return 0;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    return Math.max(0, lines.length - 1); // Başlık satırını çıkar
}

// Tüm günlerin listesini al (ASENKRON — event loop bloklamaz)
async function getAvailableDays() {
    try {
        await fsPromises.access(DATA_DIR);
    } catch {
        return [];
    }

    const allFiles = await fsPromises.readdir(DATA_DIR);
    const csvFiles = allFiles.filter(f => f.endsWith('_verileri.csv'));

    const files = [];
    for (const f of csvFiles) {
        try {
            const filePath = path.join(DATA_DIR, f);
            const stats = await fsPromises.stat(filePath);
            const content = await fsPromises.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            const dataCount = Math.max(0, lines.length - 1);
            const datePart = f.replace('_verileri.csv', '');

            files.push({
                fileName: f,
                date: datePart,
                dataCount: dataCount,
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

// Son 15 saniyenin verilerini bellekte tut (ortalama hesaplama için)
let recentData = [];
const RECENT_DATA_WINDOW = 15000; // 15 saniye

// Bağlantı durumu
let connectionStatus = {
    source: DATA_SOURCE,
    connected: false,
    lastUpdate: null,
    error: null
};

// Ortalama hesaplama için veri alanları
const numericFields = ['h', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];

// Running Average değişkenleri
let dailyAverages = {};
let dailyAveragesCount = 0;
let currentDailyFile = getDailyFileName();
numericFields.forEach(f => dailyAverages[f] = 0);

// Available days count cache — asenkron güncellenir, event loop bloklamaz
let _availableDaysCount = 0;

async function updateAvailableDaysCount() {
    try {
        const files = await fsPromises.readdir(DATA_DIR);
        _availableDaysCount = files.filter(f => f.endsWith('_verileri.csv')).length;
    } catch {
        _availableDaysCount = 0;
    }
}

// Başlangıçta ve her 60 saniyede güncelle
updateAvailableDaysCount();
setInterval(updateAvailableDaysCount, 60000);

function initDailyAverages() {
    const filePath = path.join(DATA_DIR, currentDailyFile);
    dailyAveragesCount = 0;
    numericFields.forEach(f => dailyAverages[f] = 0);

    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            if (lines.length > 1) {
                const headers = lines[0].replace('\uFEFF', '').split(';');
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(';');
                    dailyAveragesCount++;

                    numericFields.forEach(field => {
                        const index = headers.indexOf(field);
                        if (index !== -1) {
                            const val = parseFloat(values[index]);
                            if (!isNaN(val)) {
                                dailyAverages[field] += (val - dailyAverages[field]) / dailyAveragesCount;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            //console.error('Günlük ortalamalar hesaplanırken hata:', e);
        }
    }
}
// Başlangıçta ortalamaları hesapla
initDailyAverages();
// Ortalama hesaplama fonksiyonu (sadece son 15 saniye için)
function calculateAverages() {
    const now = Date.now();
    const fifteenSecondsAgo = now - RECENT_DATA_WINDOW;

    // Eski verileri temizle
    recentData = recentData.filter(d => d.timestamp >= fifteenSecondsAgo);
    let recent = [];
    const averages = {
        allTime: {}, // Running average yöntemiyle hesaplanan günlük ortalama
        last15Seconds: {},
        allTimeCount: dailyAveragesCount, // Bellekte tutulan sayaç — dosya okumaz
        last15SecondsCount: recentData.length
    };

    numericFields.forEach(field => {
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

// Debug: initDailyAverages sonuçlarını logla
//console.log(`📊 initDailyAverages: count=${dailyAveragesCount}, fv_avg=${dailyAverages.fv?.toFixed(4)}`);

// Yıldız ile ayrılmış veriyi JSON'a dönüştür
const dataFields = ['h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh', 'mt', 'watt', 'ppm', 'gx', 'gy', 'gz', 'ax', 'ay', 'az', 'flow', 'totalflow', 'gsmspeed', 'pitch', 'roll', 'yaw', 'driver_pot', 'direksiyon_angle'];

function parseStarSeparatedData(rawMessage) {
    let dataString = rawMessage;
    if (rawMessage.includes('_')) {
        dataString = rawMessage.split('_')[1];
    }
    const values = dataString.split('*');
    const data = {};
    dataFields.forEach((field, index) => {
        data[field] = values[index] !== undefined ? values[index] : null;
    });
    return data;
}
/*
function parseID(rawMessage) {
    let dataString = rawMessage;
    if (rawMessage.includes('_')) {
        dataString = rawMessage.split('_')[0];
    }
    return dataString;
}*/

// Veriyi işle ve kaydet
function processIncomingData(data) {
    dataCounter++; // Her yeni veri geldiğinde counter'ı artır

    const now = new Date();
    const dataWithTimestamp = {
        ...data, // Önce gelen veriyi spread et
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0'),
        timestamp: now.getTime(),
        receivedAt: now.getTime(), // Frontend için veri alım zamanı
        dataCounter: dataCounter // Frontend için veri sayacı
    };

    // Gün değişimi kontrolü ve Running Average güncellemesi
    const newDailyFile = getDailyFileName(now);
    if (newDailyFile !== currentDailyFile) {
        currentDailyFile = newDailyFile;
        dailyAveragesCount = 0;
        numericFields.forEach(f => dailyAverages[f] = 0);
    }

    dailyAveragesCount++;
    numericFields.forEach(field => {
        const val = parseFloat(dataWithTimestamp[field]);
        if (!isNaN(val)) {
            dailyAverages[field] += (val - dailyAverages[field]) / dailyAveragesCount;
        }
    });
    // Log throttle: her 10 veride 1 kez logla (event loop koruması)
    if (dataCounter % 10 === 0) {
        //console.log(`📊 Running avg update: count=${dailyAveragesCount}, fv_val=${dataWithTimestamp.fv}, fv_avg=${dailyAverages.fv?.toFixed(4)}`);
    }

    latestTelemetryData = dataWithTimestamp; // Sonra güncelle

    // Son 15 saniye verilerine ekle (ortalama için)
    recentData.push(dataWithTimestamp);

    // Flow verisi varsa en yakın zamanlı flow ile birleştir — kaydı ve SSE'yi aynı objeyle yap
    const matchedFlow = findBestFlowMatch(now.getTime());
    if (matchedFlow !== null) {
        dataWithTimestamp.realInstantFlow = matchedFlow.instantFlow;  // anlık flow
        dataWithTimestamp.realTotalFlow = matchedFlow.totalFlow;    // toplam flow
        dataWithTimestamp.hasRealFlow = true;
        if (dataCounter % 10 === 0) {
            //console.log(`💧 Flow eşleşmesi: anlık=${matchedFlow.instantFlow}, toplam=${matchedFlow.totalFlow}`);
        }
    } else {
        dataWithTimestamp.realInstantFlow = null;
        dataWithTimestamp.realTotalFlow = null;
        dataWithTimestamp.hasRealFlow = false;
    }

    // Dosyaya yazılacak verilere ekle (realFlow dahil)
    pendingData.push(dataWithTimestamp);

    // 5 veri birikince dosyaya yaz
    if (pendingData.length >= FLUSH_THRESHOLD) {
        flushDataToFile();
    }

    // Test modu aktifse test verilerini de kaydet (realFlow dahil)
    // Duraklatılmışsa veri kaydedilmez
    if (testMode.active && !testMode.paused && testMode.startTime) {
        // Gerçek geçen süre = toplam süre - duraklatılmış süre
        const rawElapsed = now.getTime() - testMode.startTime;
        const elapsedMs = rawElapsed - testMode.pausedElapsed;
        const testTime = formatTestTime(elapsedMs);

        const testDataWithTime = {
            test_time: testTime,
            ...dataWithTimestamp
        };

        testMode.pendingTestData.push(testDataWithTime);

        if (testMode.pendingTestData.length >= FLUSH_THRESHOLD) {
            flushTestDataToFile();
        }
    }

    // TÜBİTAK formatında kaydet — her veri geldiğinde
    // İlk veri veya 60 saniyeden uzun boşluk → yeni dosya başlat
    const tubitakGap = tubitakSession.lastDataTime
        ? (now.getTime() - tubitakSession.lastDataTime)
        : 0;
    if (!tubitakSession.startTime || tubitakGap > 60000) {
        if (tubitakGap > 60000) {
            //console.log(`📋 TÜBİTAK: ${(tubitakGap / 1000).toFixed(0)}s boşluk algılandı → yeni dosya oluşturuluyor`);
        }
        initTubitakSession(now);

    }
    /*
        if (parseID(dataString) == "01") {
            //initTubitakSession(now);
        }
    
    */
    tubitakSession.lastDataTime = now.getTime();
    const elapsedMs = now.getTime() - tubitakSession.startTime;
    // hiz_kmh
    const tbkHiz = dataWithTimestamp.h != null ? dataWithTimestamp.h : '';
    // T_bat_C: t1, t2, t3 arasından en yüksek değer
    const tbkTemps = [dataWithTimestamp.t1, dataWithTimestamp.t2, dataWithTimestamp.t3]
        .map(v => parseFloat(v)).filter(v => !isNaN(v));
    const tbkTBat = tbkTemps.length > 0 ? Math.max(...tbkTemps) : '';
    // T_tank_C: şimdilik yakıt hücresi harici sıcaklık (fet)
    const tbkTTank = dataWithTimestamp.fet != null ? dataWithTimestamp.fet : '';
    // V_bat_V: toplam batarya gerilimi
    const tbkVBat = dataWithTimestamp.bv != null ? dataWithTimestamp.bv : '';
    // kalan_enerji_Wh
    const tbkKalan = dataWithTimestamp.ke != null ? dataWithTimestamp.ke : '';
    const tubitakRow = `${elapsedMs};${tbkHiz};${tbkTBat};${tbkTTank};${tbkVBat};${tbkKalan}`;
    tubitakSession.pending.push(tubitakRow);
    flushTubitakData();

    connectionStatus.connected = true;
    connectionStatus.lastUpdate = now.toISOString();
    connectionStatus.error = null;

    // SSE ile tüm bağlı client'lara veri gönder
    broadcastToClients(dataWithTimestamp);

    if (dataCounter % 10 === 0) {
        const speed = latestTelemetryData.h || 'N/A';
        const soc = latestTelemetryData.soc || 'N/A';
        const testInfo = testMode.active ? ' | 🧪 TEST AKTİF' : '';
        //console.log(`📥 [${DATA_SOURCE}] Veri alındı (#${dataCounter}): Hız=${speed} km/h, SOC=${soc}% | Bugün: ${dailyAveragesCount} | Bekleyen: ${pendingData.length}${testInfo}`);
    }
}

// Test zamanını formatla (HH:MM:SS.mmm)
function formatTestTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}


// ============================================
// MQTT BAĞLANTISI
// ============================================
let mqttClient = null;

function startMQTT() {
    //console.log('MQTT broker bağlanılıyor...');
    mqttClient = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        // TCP Nagle algoritmasını kapat — küçük MQTT paketleri biriktirilmeden anında gelsin
        if (mqttClient.stream) {
            mqttClient.stream.setNoDelay(true);
            //console.log('⚡ MQTT TCP_NODELAY aktif');
        }
        //console.log('MQTT broker bağlandı!');
        connectionStatus.connected = true;
        mqttClient.subscribe(MQTT_TOPIC, { qos: 0 }, (error) => {
            if (error) {
                //console.error('Topice abone olma hatası:', error);
            } else {
                //console.log(`📡 Topice abone olundu: ${MQTT_TOPIC}`);
            }
        });

        mqttClient.subscribe("flow", { qos: 0 }, (error) => {
            if (error) {
                //console.error('Topice abone olma hatası:', error);
            } else {
                //console.log(`📡 Topice abone olundu: flow`);
            }
        });


    });

    mqttClient.on('message', (topic, message) => {
        try {
            if (topic == MQTT_TOPIC) {
                const rawMessage = message.toString().trim();
                // HAM VERİ logu kaldırıldı — her mesajda stdout yazımı event loop'u bloklar
                const data = parseStarSeparatedData(rawMessage);
                processIncomingData(data);
            }

            if (topic == "flow") {
                const rawFlow = message.toString().trim();
                // FLOW HAM VERİ logu kaldırıldı — performans optimizasyonu
                const flowTimestamp = Date.now();
                // rawFlow string'ini buffer'a ekle ("anlık*toplam" formatı)
                addFlowToBuffer(rawFlow, flowTimestamp);

                // data topic'ini beklemeden anlık olarak SSE'ye gönder
                let instantFlow = null, totalFlow = null;
                if (rawFlow.includes('*')) {
                    const parts = rawFlow.split('*');
                    const a = parseFloat(parts[0]);
                    const b = parseFloat(parts[1]);
                    if (!isNaN(a)) instantFlow = a;
                    if (!isNaN(b)) totalFlow = b;
                } else {
                    const v = parseFloat(rawFlow);
                    if (!isNaN(v)) instantFlow = v;
                }
                broadcastToClients({
                    type: 'flow_update',
                    hasRealFlow: true,
                    realInstantFlow: instantFlow,
                    realTotalFlow: totalFlow,
                    flowTimestamp
                });
            }

            // 250ms sonra supercapacitor durumunu MQTT_TAKE topic'ine gönder
            setTimeout(() => {
                if (mqttClient && mqttClient.connected) {
                    mqttClient.publish(MQTT_TAKE, supercapacitor ? '1' : '0', { qos: 1 });
                    //console.log(`📤 MQTT_TAKE gönderildi: ${supercapacitor ? '1' : '0'}`);
                }
            }, 250);
        } catch (error) {
            //console.error('Mesaj parse hatası:', error);
            //console.error(' Ham veri:', message.toString());
        }
    });

    mqttClient.on('error', (error) => {
        //console.error('MQTT bağlantı hatası:', error.message);
        connectionStatus.connected = false;
        connectionStatus.error = error.message;
    });

    mqttClient.on('offline', () => {
        //console.log(' MQTT bağlantısı kesildi');
        connectionStatus.connected = false;
    });

    mqttClient.on('reconnect', () => {
        //console.log('MQTT yeniden bağlanıyor...');
    });
}

function stopMQTT() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        //console.log(' MQTT bağlantısı kapatıldı');
    }
}

// ============================================
// HTTP MODE (Araç bize GET isteği yapar)
// ============================================
let httpModeActive = false;
let supercapacitor = false;

function startHTTP() {
    httpModeActive = true;
    //console.log('HTTP modu aktif - Araçtan veri bekleniyor...');
    //console.log('Endpoint: GET /api/telemetry?h=...&x=...&y=...');
}

function stopHTTP() {
    httpModeActive = false;
    //console.log('HTTP modu kapatıldı');
}

// ============================================
// VERI KAYNAGI YÖNETİMİ
// ============================================
function switchDataSource(newSource) {
    if (newSource !== 'MQTT' && newSource !== 'HTTP') {
        return { success: false, error: 'Geçersiz kaynak. MQTT veya HTTP olmalı.' };
    }

    if (newSource === DATA_SOURCE) {
        return { success: true, message: `Zaten ${newSource} modunda` };
    }

    // Mevcut kaynağı durdur
    if (DATA_SOURCE === 'MQTT') {
        stopMQTT();
    } else {
        stopHTTP();
    }

    // Yeni kaynağı başlat
    DATA_SOURCE = newSource;
    connectionStatus.source = newSource;
    connectionStatus.connected = false;

    if (newSource === 'MQTT') {
        startMQTT();
    } else {
        startHTTP();
    }

    //console.log(`Veri kaynağı değiştirildi: ${newSource}`);
    return { success: true, message: `Veri kaynağı ${newSource} olarak değiştirildi` };
}

// Başlangıçta veri kaynağını başlat
function initDataSource() {
    //console.log(`\n Veri kaynağı: ${DATA_SOURCE}`);
    if (DATA_SOURCE === 'MQTT') {
        startMQTT();
    } else {
        startHTTP();
    }
}

// ============================================
// OPTİMİZE EDİLMİŞ /data ENDPOINT (Middleware'lerden ÖNCE)
// 2G GSM için minimum gecikme - middleware bypass
// ============================================
app.get('/data', (req, res) => {
    // Performans ölçümü
    const startTime = process.hrtime.bigint();

    if (DATA_SOURCE !== 'HTTP') {
        return res.status(400).send('DISABLED');
    }

    const q = req.query;

    // KEY kontrolünü hemen yap
    if (q.key !== key || !q.key) {
        //console.log('⚠️ Unauthorized access detected');
        return res.status(401).send('UNAUTHORIZED');
    }

    // ÖNCE CEVABI GÖNDER - minimum latency için kritik
    res.removeHeader('X-Powered-By');
    // Supercapacitor durumuna göre yanıt
    if (supercapacitor) {
        res.setHeader('Content-Length', 1);
        res.status(200).send('1');
    } else {
        res.setHeader('Content-Length', 0);
        res.status(200).send('');
    }

    // Performans logla
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;

    // SONRA asenkron olarak veriyi işle (non-blocking)
    setImmediate(() => {
        const data = {
            h: q.h || null,
            x: q.x || null,
            y: q.y || null,
            gp: q.gp || null,
            gs: q.gs || null,
            fv: q.fv || null,
            fa: q.fa || null,
            fw: q.fw || null,
            fet: q.fet || null,
            fit: q.fit || null,
            kz: q.kz || null,
            bv: q.bv || null,
            bc: q.bc || null,
            bw: q.bw || null,
            bwh: q.bwh || null,
            t1: q.t1 || null,
            t2: q.t2 || null,
            t3: q.t3 || null,
            soc: q.soc || null,
            ke: q.ke || null,
            jv: q.jv || null,
            jc: q.jc || null,
            jw: q.jw || null,
            jwh: q.jwh || null,
            mt: q.mt || null,
            id: q.id || null,
            gx: q.gx || null,
            gy: q.gy || null,
            gz: q.gz || null,
            gsmspeed: q.gsmspeed || null,
            //key: q.key || null
        };

        processIncomingData(data);
        //console.log(`⚡ /data response: ${durationMs.toFixed(2)}ms | Hız=${data.h}`);
    });
});

// ============================================
// EXPRESS MIDDLEWARE
// ============================================
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.text({ limit: '20mb', type: ['text/plain', 'text/csv', 'application/octet-stream'] }));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'hidroana-telemetri-secret-key-2024-' + Math.random().toString(36),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'strict'
    }
}));

const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        //console.error('Kullanıcılar yüklenirken hata:', error);
    }
    return [];
}

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }
}

// Admin yetkisi gerektiren işlemler için middleware
function requireAdmin(req, res, next) {
    if (req.session && req.session.userId) {
        if (req.session.userRole === 'admin') {
            next();
        } else {
            res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekiyor' });
        }
    } else {
        res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }
}

// ============================================
// API ENDPOINTS
// ============================================

// Auth endpoints
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.userRole = user.role || 'user'; // Rol bilgisini session'a kaydet
        res.json({ success: true, message: 'Giriş başarılı', user: { id: user.id, username: user.username, role: user.role || 'user' } });
    } else {
        res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Çıkış yapılırken hata oluştu' });
        res.json({ success: true, message: 'Çıkış başarılı' });
    });
});

app.get('/api/auth/check', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username, role: req.session.userRole || 'user' } });
    } else {
        res.json({ authenticated: false });
    }
});

// Telemetri endpoints
// SSE Stream Endpoint - Event-Driven veri akışı
app.get('/api/telemetry/stream', requireAuth, (req, res) => {
    // TCP Nagle algoritmasını devre dışı bırak — küçük paketler birikmeden anında gönderilsin
    if (req.socket) {
        req.socket.setNoDelay(true);
        req.socket.setTimeout(0);
    }

    // SSE Headers — tüm proxy katmanlarına buffering'i kapat
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');   // Nginx için
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();

    // Client'ı listeye ekle
    sseClients.add(res);
    //console.log(`🔌 SSE client bağlandı. Toplam: ${sseClients.size}`);

    // İlk bağlantıda mevcut veriyi gönder — sadece son 25 saniye içinde gelmişse
    const STALE_THRESHOLD_MS = 25000; // 25 saniye
    if (latestTelemetryData && latestTelemetryData.receivedAt) {
        const dataAge = Date.now() - latestTelemetryData.receivedAt;
        if (dataAge <= STALE_THRESHOLD_MS) {
            res.write(`data: ${JSON.stringify(latestTelemetryData)}\n\n`);
        } else {
            //console.log(`⏳ SSE: Son veri ${(dataAge / 1000).toFixed(1)}s eski, yeni client'a gönderilmedi.`);
        }
    }

    // Heartbeat - bağlantıyı canlı tut (her 30 saniyede)

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    // Client bağlantısı kesildiğinde temizle
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        //console.log(`🔌 SSE client ayrıldı. Toplam: ${sseClients.size}`);
    });
});
/*
app.get('/api/telemetry/flow', requireAuth, (req, res) => {
        // SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx için
    res.flushHeaders();


});
*/
// Eski polling endpoint (geriye uyumluluk için)
app.get('/api/telemetry', requireAuth, (req, res) => {
    if (!latestTelemetryData) {
        return res.status(503).json({ error: 'Henüz veri alınmadı' });
    }

    // Son veri alım zamanını kontrol et (5 saniyeden eski mi?)
    const now = Date.now();
    const lastDataTime = latestTelemetryData.receivedAt || 0;
    const timeSinceLastData = now - lastDataTime;

    // 5 saniyeden fazla veri gelmemişse bağlantı kesildi
    if (timeSinceLastData > 5000) {
        //console.log(`⚠️ Veri akışı kesildi (${timeSinceLastData}ms önce)`);
        return res.status(503).json({
            error: 'Veri akışı kesildi',
            lastDataTime: lastDataTime,
            timeSinceLastData: timeSinceLastData
        });
    }

    res.json(latestTelemetryData);
});

app.get('/api/telemetry/count', requireAuth, (req, res) => {
    // Cache'den oku — dosya I/O yok, event loop bloklanmaz
    res.json({
        count: dailyAveragesCount,
        pendingCount: pendingData.length,
        todayFile: getDailyFileName(),
        availableDays: _availableDaysCount
    });
});

app.get('/api/telemetry/averages', requireAuth, (req, res) => {
    res.json(calculateAverages());
});

// Son alınan verinin zaman damgasını döndür
app.get('/api/telemetry/last-received', requireAuth, (req, res) => {
    if (!latestTelemetryData) {
        return res.json({ lastReceived: null });
    }
    res.json({
        lastReceived: latestTelemetryData.receivedAt || null,
        date: latestTelemetryData.date || null,
        time: latestTelemetryData.time || null
    });
});

// Mevcut günlerin listesi (SADECE ADMIN)
app.get('/api/telemetry/days', requireAdmin, async (req, res) => {
    const days = await getAvailableDays();
    res.json({ days });
});

// ============================================
// TEST MODU API ENDPOINTS
// ============================================

// Test başlat (SADECE ADMIN)
app.post('/api/test/start', requireAdmin, (req, res) => {
    if (testMode.active) {
        return res.status(400).json({ error: 'Zaten aktif bir test var', testName: testMode.testName });
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    testMode.active = true;
    testMode.startTime = now.getTime();
    testMode.testName = `test_${day}-${month}-${year}_${hours}-${minutes}-${seconds}.csv`;
    testMode.pendingTestData = [];

    //console.log(`Test başlatıldı: ${testMode.testName}`);

    res.json({
        success: true,
        message: 'Test başlatıldı',
        testName: testMode.testName,
        startTime: now.toISOString()
    });
});

// Test durdur (SADECE ADMIN)
app.post('/api/test/stop', requireAdmin, (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }

    // Bekleyen test verilerini kaydet
    if (testMode.pendingTestData.length > 0) {
        flushTestDataToFile();
    }

    const endTime = Date.now();
    const duration = endTime - testMode.startTime;
    const testName = testMode.testName;

    // Test dosyasındaki veri sayısını al
    const filePath = path.join(TEST_DIR, testName);
    let dataCount = 0;
    if (false /* fs.existsSync() */) {
        const content = '{}' /* fs.readFileSync() */;
        const lines = content.split('\n').filter(line => line.trim());
        dataCount = Math.max(0, lines.length - 1);
    }

    // Gerçek süre = toplam süre - duraklatılmış süre
    const realDuration = duration - testMode.pausedElapsed;
    //.log(`Test durduruldu: ${testName} | Süre: ${formatTestTime(realDuration)} | Veri: ${dataCount}`);

    testMode.active = false;
    testMode.startTime = null;
    testMode.testName = null;
    testMode.pendingTestData = [];
    testMode.paused = false;
    testMode.pausedAt = null;
    testMode.pausedElapsed = 0;

    res.json({
        success: true,
        message: 'Test durduruldu',
        testName: testName,
        duration: formatTestTime(realDuration),
        durationMs: realDuration,
        dataCount: dataCount
    });
});

// Test durumu
app.get('/api/test/status', requireAuth, (req, res) => {
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
        startTime: new Date(testMode.startTime).toISOString(),
        elapsed: elapsed,
        elapsedFormatted: formatTestTime(elapsed),
        pendingData: testMode.pendingTestData.length
    });
});

// Test duraklat (SADECE ADMIN)
app.post('/api/test/pause', requireAdmin, (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }
    if (testMode.paused) {
        return res.status(400).json({ error: 'Test zaten duraklatılmış' });
    }

    testMode.paused = true;
    testMode.pausedAt = Date.now();

    // Bekleyen verileri hemen kaydet
    if (testMode.pendingTestData.length > 0) {
        flushTestDataToFile();
    }

    // console.log(`⏸️ Test duraklatıldı: ${testMode.testName}`);
    res.json({ success: true, message: 'Test duraklatıldı', testName: testMode.testName });
});

// Test devam ettir (SADECE ADMIN)
app.post('/api/test/resume', requireAdmin, (req, res) => {
    if (!testMode.active) {
        return res.status(400).json({ error: 'Aktif test yok' });
    }
    if (!testMode.paused) {
        return res.status(400).json({ error: 'Test duraklatılmamış' });
    }

    // Duraklatılmış süreyi birikimli olarak ekle
    const pauseDuration = Date.now() - testMode.pausedAt;
    testMode.pausedElapsed += pauseDuration;
    testMode.paused = false;
    testMode.pausedAt = null;

    //console.log(`▶️ Test devam ediyor: ${testMode.testName} | Duraklatma süresi: ${formatTestTime(pauseDuration)}`);
    res.json({ success: true, message: 'Test devam ediyor', testName: testMode.testName, pauseDuration });
});

// Test dosyalarını listele (SADECE ADMIN)
app.get('/api/test/files', requireAdmin, async (req, res) => {
    const files = await getTestFiles();
    res.json({ files });
});

// Test dosyasını indir (SADECE ADMIN)
app.get('/api/test/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    // Güvenlik kontrolü
    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // RFC 5987 encoding for Turkish characters and spaces in filename
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(filePath);
});

// Test dosyasını XLSX olarak indir (SADECE ADMIN)
app.get('/api/test/download-xlsx/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
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
        const encodedFileName = encodeURIComponent(xlsxFileName);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${xlsxFileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
        res.send(xlsxBuffer);
    } catch (error) {
        //console.error('XLSX dönüştürme hatası:', error);
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// Test dosyasını yeniden adlandır (SADECE ADMIN)
app.patch('/api/test/rename/:fileName', requireAdmin, (req, res) => {
    const oldFileName = req.params.fileName;
    const { newName } = req.body;

    // Güvenlik kontrolü - eski dosya adı
    if (!oldFileName.endsWith('.csv') || oldFileName.includes('..') || oldFileName.includes('/')) {
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
        //console.log(`📝 Test dosyası yeniden adlandırıldı: ${oldFileName} → ${cleanName}`);
        res.json({
            success: true,
            message: `Dosya yeniden adlandırıldı`,
            oldName: oldFileName,
            newName: cleanName
        });
    } catch (error) {
        //console.error('Dosya yeniden adlandırma hatası:', error);
        res.status(500).json({ error: 'Dosya yeniden adlandırılamadı' });
    }
});

// Test dosyasını sil (SADECE ADMIN)
app.delete('/api/test/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/') || fileName.includes('~') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    //console.log(`🗑️ Test dosyası silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

// ============================================
// TÜBİTAK API ENDPOINTS
// ============================================

// TÜBİTAK dosyalarını listele (SADECE ADMIN)
app.get('/api/tubitak/files', requireAdmin, (req, res) => {
    const files = getTubitakFiles();
    res.json({ files });
});

// TÜBİTAK dosyasını indir (SADECE ADMIN)
app.get('/api/tubitak/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.startsWith('tubitak_') || !fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TUBITAK_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(filePath);
});

// TÜBİTAK dosyasını sil (SADECE ADMIN)
app.delete('/api/tubitak/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.startsWith('tubitak_') || !fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(TUBITAK_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    //console.log(`🗑️ TÜBİTAK dosyası silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

// Belirli bir günün verisini indir (SADECE ADMIN)
app.get('/api/telemetry/download/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    // Güvenlik kontrolü - sadece csv dosyaları
    if (!fileName.endsWith('_verileri.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // RFC 5987 encoding for Turkish characters and spaces in filename
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(filePath);
});

// Belirli bir günün verisini XLSX olarak indir (SADECE ADMIN)
app.get('/api/telemetry/download-xlsx/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('_verileri.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    try {
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const xlsxBuffer = csvToXlsxBuffer(csvContent, 'Telemetri');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Dosya boş' });
        }
        const xlsxFileName = fileName.replace('.csv', '.xlsx');
        const encodedFileName = encodeURIComponent(xlsxFileName);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${xlsxFileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
        res.send(xlsxBuffer);
    } catch (error) {
        //console.error('XLSX dönüştürme hatası:', error);
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// Bugünün verisini indir (bekleyen veriler dahil) (SADECE ADMIN)
app.get('/api/telemetry/download-today', requireAdmin, (req, res) => {
    // Önce bekleyen verileri dosyaya yaz
    flushDataToFile();

    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz veri toplanmadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // RFC 5987 encoding for Turkish characters and spaces in filename
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(filePath);
});

// Bugünün verisini XLSX olarak indir (SADECE ADMIN)
app.get('/api/telemetry/download-today-xlsx', requireAdmin, (req, res) => {
    flushDataToFile();

    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz veri toplanmadı' });
    }

    try {
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const xlsxBuffer = csvToXlsxBuffer(csvContent, 'Bugün');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Dosya boş' });
        }
        const xlsxFileName = fileName.replace('.csv', '.xlsx');
        const encodedFileName = encodeURIComponent(xlsxFileName);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${xlsxFileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
        res.send(xlsxBuffer);
    } catch (error) {
        // console.error('XLSX dönüştürme hatası:', error);
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// Belirli bir günün verisini sil (SADECE ADMIN)
app.delete('/api/telemetry/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('_verileri.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    //console.log(`🗑️ Dosya silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

// Bugünün verilerini temizle (SADECE ADMIN)
app.delete('/api/telemetry/clear', requireAdmin, (req, res) => {
    // Bugünün dosyasını sil ve bekleyen verileri temizle
    const fileName = getDailyFileName();
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

    console.log(`Bugünün verileri temizlendi. Silinen kayıt: ${clearedCount}`);
    res.json({ success: true, clearedCount });
});

// ============================================
// /data ENDPOINT YUKARI TAŞINDI (Middleware optimizasyonu)
// Bkz: Satır ~443 - EXPRESS MIDDLEWARE bölümünden önce
// ============================================



app.get('/capacitor', requireAdmin, (req, res) => {
    action = req.query;

    if (action.turn == '1') {
        supercapacitor = true;
        return res.status(200).json(1);
    } else if (action.turn == '0') {
        supercapacitor = false;
        return res.status(200).json(0);
    }
    // Sadece turn parametresi yoksa mevcut durumu döndür
    return res.status(200).json(supercapacitor ? 1 : 0);
});


// CSV export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
app.get('/api/telemetry/csv', requireAdmin, async (req, res) => {
    // Önce bekleyen verileri dosyaya yaz
    await flushDataToFile();

    const days = await getAvailableDays();

    if (days.length === 0) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }

    let csv = '\uFEFF' + CSV_HEADERS.join(';') + '\n';

    // Tüm dosyaları birleştir (asenkron)
    for (const day of days) {
        const filePath = path.join(DATA_DIR, day.fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        lines.slice(1).forEach(line => {
            if (line.trim()) csv += line + '\n';
        });
    }

    const filename = `telemetry_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFilename}`);
    res.send(csv);
});

// XLSX export - Tüm günlerin verilerini birleştir (SADECE ADMIN)
app.get('/api/telemetry/xlsx', requireAdmin, async (req, res) => {
    await flushDataToFile();

    const days = await getAvailableDays();

    if (days.length === 0) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }

    let csv = CSV_HEADERS.join(';') + '\n';

    for (const day of days) {
        const filePath = path.join(DATA_DIR, day.fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        lines.slice(1).forEach(line => {
            if (line.trim()) csv += line + '\n';
        });
    }

    try {
        const xlsxBuffer = csvToXlsxBuffer(csv, 'Tüm Veriler');
        if (!xlsxBuffer) {
            return res.status(404).json({ error: 'Veri bulunamadı' });
        }
        const filename = `telemetry_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFilename}`);
        res.send(xlsxBuffer);
    } catch (error) {
        //console.error('XLSX dönüştürme hatası:', error);
        res.status(500).json({ error: 'XLSX dosyası oluşturulamadı' });
    }
});

// ============================================
// VERI KAYNAGI API (MQTT/HTTP geçişi)
// ============================================
app.get('/api/source/status', requireAuth, (req, res) => {
    // Son veri alım zamanını kontrol et
    const now = Date.now();
    const lastDataTime = latestTelemetryData?.receivedAt || 0;
    const timeSinceLastData = now - lastDataTime;

    // 5 saniyeden fazla veri gelmemişse bağlantı kesildi olarak işaretle
    const isDataFlowing = timeSinceLastData <= 5000 && latestTelemetryData;

    res.json({
        ...connectionStatus,
        connected: isDataFlowing,
        timeSinceLastData: timeSinceLastData,
        lastDataTime: lastDataTime
    });
});

// Veri kaynağını değiştir (SADECE ADMIN)
app.post('/api/source/switch', requireAdmin, (req, res) => {
    const { source } = req.body;
    const result = switchDataSource(source);
    res.json(result);
});

app.get('/api/source/config', requireAuth, (req, res) => {
    res.json({
        currentSource: DATA_SOURCE
    });
});

// ============================================
// STATIC FILES & ROUTES
// ============================================
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/fullmap', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'mobile.html'));
});

app.get('/sectors', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'sectors.html'));
});

app.get('/race', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'race.html'));
});

app.get('/laps', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'laps.html'));
});

app.get('/play', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/flow', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'flow.html'));
})

app.get('/3dview', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, '3dview.html'));
})

// ============================================
// LAP/RACE API ENDPOINTS
// ============================================

// Lap SSE Stream - tüm kullanıcılar izleyebilir
app.get('/api/laps/stream', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    lapSSEClients.add(res);
    //.log(`🔌 Lap SSE client bağlandı. Toplam: ${lapSSEClients.size}`);

    // İlk bağlantıda mevcut durumu gönder
    const initData = {
        type: 'lap_update',
        active: lapState.active,
        startTime: lapState.startTime,
        startJwh: lapState.startJwh,
        laps: lapState.laps,
        currentJwh: lapState.currentJwh,
        serverTime: Date.now()
    };
    res.write(`data: ${JSON.stringify(initData)}\n\n`);

    // Heartbeat
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        lapSSEClients.delete(res);
        //console.log(`🔌 Lap SSE client ayrıldı. Toplam: ${lapSSEClients.size}`);
    });
});

// Yarışı başlat (SADECE ADMIN)
app.post('/api/laps/start', requireAdmin, (req, res) => {
    if (lapState.active) {
        return res.status(400).json({ error: 'Yarış zaten aktif' });
    }

    const now = Date.now();
    const currentJwh = latestTelemetryData ? (parseFloat(latestTelemetryData.jwh) || 0) : 0;

    lapState = {
        active: true,
        startTime: now,
        startJwh: currentJwh,
        laps: [],
        currentJwh: currentJwh
    };

    //console.log(`🏁 Yarış başlatıldı! Başlangıç Jwh: ${currentJwh}`);
    broadcastLapState();

    res.json({
        success: true,
        message: 'Yarış başlatıldı',
        startTime: now,
        startJwh: currentJwh
    });
});

// Tur kaydet (SADECE ADMIN)
app.post('/api/laps/lap', requireAdmin, (req, res) => {
    if (!lapState.active) {
        return res.status(400).json({ error: 'Yarış aktif değil' });
    }

    const now = Date.now();
    const currentJwh = latestTelemetryData ? (parseFloat(latestTelemetryData.jwh) || 0) : 0;
    const lapNum = lapState.laps.length + 1;

    const lapStartTime = lapState.laps.length > 0
        ? lapState.laps[lapState.laps.length - 1].endTime
        : lapState.startTime;

    const lapStartJwh = lapState.laps.length > 0
        ? lapState.laps[lapState.laps.length - 1].endJwh
        : lapState.startJwh;

    const lap = {
        lapNum: lapNum,
        startTime: lapStartTime,
        endTime: now,
        lapDuration: now - lapStartTime,
        startJwh: lapStartJwh,
        endJwh: currentJwh,
        lapJwh: currentJwh - lapStartJwh
    };

    lapState.laps.push(lap);
    lapState.currentJwh = currentJwh;

    //console.log(`🏁 Tur ${lapNum} kaydedildi! Süre: ${lap.lapDuration}ms, Wh: ${lap.lapJwh.toFixed(3)}`);
    broadcastLapState();

    res.json({
        success: true,
        message: `Tur ${lapNum} kaydedildi`,
        lap: lap
    });
});

// Yarışı durdur (SADECE ADMIN)
app.post('/api/laps/stop', requireAdmin, (req, res) => {
    if (!lapState.active) {
        return res.status(400).json({ error: 'Yarış aktif değil' });
    }

    lapState.active = false;

    // Tur varsa dosyaya kaydet (henüz kaydedilmediyse)
    let savedFile = null;
    if (lapState.laps.length > 0 && !lapState.savedFileName) {
        savedFile = saveRaceToFile();
        lapState.savedFileName = savedFile;
    }

    //console.log(`🏁 Yarış durduruldu! Toplam ${lapState.laps.length} tur${savedFile ? ` | Kaydedildi: ${savedFile}` : ''}`);
    broadcastLapState();

    res.json({
        success: true,
        message: 'Yarış durduruldu',
        lapCount: lapState.laps.length,
        savedFile: savedFile
    });
});

// Yarışı sıfırla (SADECE ADMIN) - mevcut verileri kaydet ve sıfırla
app.post('/api/laps/reset', requireAdmin, (req, res) => {
    // Stop sırasında kaydedilmediyse şimdi kaydet
    let savedFile = lapState.savedFileName || null;
    if (lapState.laps.length > 0 && !lapState.savedFileName) {
        savedFile = saveRaceToFile();
    }

    lapState = {
        active: false,
        startTime: null,
        startJwh: null,
        laps: [],
        currentJwh: 0,
        savedFileName: null
    };

    //console.log(`🏁 Yarış sıfırlandı!${savedFile ? ` Kaydedilen dosya: ${savedFile}` : ''}`);
    broadcastLapState();

    res.json({
        success: true,
        message: savedFile ? `Yarış kaydedildi ve sıfırlandı` : 'Yarış sıfırlandı',
        savedFile: savedFile
    });
});

// Eski yarış kayıtlarını listele
app.get('/api/races/list', requireAuth, (req, res) => {
    if (!false /* fs.existsSync() */) {
        return res.json({ races: [] });
    }

    const races = [] /* fs.readdirSync() */
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const filePath = path.join(RACES_DIR, f);
                const data = JSON.parse('{}' /* fs.readFileSync() */);
                return data;
            } catch (e) {
                return null;
            }
        })
        .filter(r => r !== null)
        .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    res.json({ races });
});

// Eski yarış CSV dosyasını indir
app.get('/api/races/download/:fileName', requireAuth, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(RACES_DIR, fileName);

    if (!false /* fs.existsSync() */) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(filePath);
});

// Eski yarış dosyasını yeniden adlandır (SADECE ADMIN)
app.post('/api/races/rename', requireAdmin, (req, res) => {
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

    if (!false /* fs.existsSync() */) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
    if (false /* fs.existsSync() */) {
        return res.status(409).json({ error: 'Bu isimde zaten bir dosya var' });
    }

    try {
        /* fs.renameSync(); */
        if (false /* fs.existsSync() */) {
            const meta = JSON.parse('{}' /* fs.readFileSync() */);
            meta.fileName = newFileName;
            /* fs.writeFileSync(newJsonPath, JSON.stringify(meta, null, 2), 'utf8'); */
            /* fs.unlinkSync(); */
        }
        //console.log(`📁 Yarış yeniden adlandırıldı: ${oldFileName} → ${newFileName}`);
        res.json({ success: true, newFileName });
    } catch (e) {
        //console.error('Yeniden adlandırma hatası:', e);
        res.status(500).json({ error: 'Yeniden adlandırma başarısız: ' + e.message });
    }
});

// Eski yarış dosyasını sil (SADECE ADMIN)
app.delete('/api/races/delete/:fileName(*)', requireAdmin, (req, res) => {
    // Express paramı otomatik decode eder; '*' wildcard ile '/' içeren adlar da işlenir
    const fileName = req.params.fileName;

    if (!fileName || !fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const base = fileName.slice(0, -4);
    const csvPath = path.join(RACES_DIR, `${base}.csv`);
    const jsonPath = path.join(RACES_DIR, `${base}.json`);

    if (!false /* fs.existsSync() */) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    try {
        /* fs.unlinkSync(); */
        if (false /* fs.existsSync() */) /* fs.unlinkSync(); */
            //console.log(`🗑️ Yarış silindi: ${fileName}`);
            res.json({ success: true });
    } catch (e) {
        //console.error('Silme hatası:', e);
        res.status(500).json({ error: 'Silme başarısız: ' + e.message });
    }
});

// ============================================
// SECTOR API
// ============================================

// Sector kaydet
app.post('/api/sectors/save', requireAuth, (req, res) => {
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

// Sector listesi
app.get('/api/sectors/list', requireAdmin, (req, res) => {
    const files = fs.readdirSync()
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

// Sector yükle
app.get('/api/sectors/load/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.json') || fileName.includes('..')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(SECTORS_DIR, fileName);

    if (!fs.existsSync()) {
        return res.status(404).json({ error: 'Sector bulunamadı' });
    }

    const data = JSON.parse(fs.readFileSync(filePath));
    res.json(data);
});

// Sector sil
app.delete('/api/sectors/delete/:fileName', requireAdmin, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.json') || fileName.includes('..')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(SECTORS_DIR, fileName);

    if (!fs.existsSync()) {
        return res.status(404).json({ error: 'Sector bulunamadı' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
});

// ============================================
// REALTIME SECTOR API
// ============================================

// Sunucu taraflı CSV medyan hesaplama yardımcısı
function calcMedianServer(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Sunucu taraflı alt-sektör tespit fonksiyonu
const SUB_SECTOR_NOISE = 1.5; // km/h

function detectSubSectorsServer(rows, sectorId) {
    if (rows.length < 2) {
        return [{
            id: sectorId + '.1',
            startMeter: rows[0].s,
            endMeter: rows[rows.length - 1].s,
            entrySpeed: rows[0].v,
            exitSpeed: rows[rows.length - 1].v,
            type: 'flat',
            coords: rows.map(r => [r.lat, r.lon])
        }];
    }

    const smoothed = rows.map((r, i) => {
        if (i === 0 || i === rows.length - 1) return r.v;
        return (rows[i - 1].v + r.v + rows[i + 1].v) / 3;
    });

    let currentTrend = null;
    let segStart = 0;
    for (let i = 1; i < smoothed.length; i++) {
        const diff = smoothed[i] - smoothed[segStart];
        if (Math.abs(diff) >= SUB_SECTOR_NOISE) {
            currentTrend = diff > 0 ? 'accel' : 'decel';
            break;
        }
    }
    if (!currentTrend) {
        return [{
            id: sectorId + '.1',
            startMeter: rows[0].s,
            endMeter: rows[rows.length - 1].s,
            entrySpeed: rows[0].v,
            exitSpeed: rows[rows.length - 1].v,
            type: 'flat',
            coords: rows.map(r => [r.lat, r.lon])
        }];
    }

    const subSectors = [];
    let subCount = 0;
    let lastPeak = smoothed[segStart];

    for (let i = 1; i < smoothed.length; i++) {
        const diff = smoothed[i] - lastPeak;
        let trendChanged = false;
        if (currentTrend === 'accel' && diff < -SUB_SECTOR_NOISE) trendChanged = true;
        else if (currentTrend === 'decel' && diff > SUB_SECTOR_NOISE) trendChanged = true;

        if (currentTrend === 'accel' && smoothed[i] > lastPeak) lastPeak = smoothed[i];
        else if (currentTrend === 'decel' && smoothed[i] < lastPeak) lastPeak = smoothed[i];

        if (trendChanged || i === smoothed.length - 1) {
            const endIdx = (trendChanged && i > 0) ? i - 1 : i;
            subCount++;
            const segRows = rows.slice(segStart, endIdx + 1);
            if (segRows.length >= 1) {
                subSectors.push({
                    id: sectorId + '.' + subCount,
                    startMeter: segRows[0].s,
                    endMeter: segRows[segRows.length - 1].s,
                    entrySpeed: Math.round(segRows[0].v * 10) / 10,
                    exitSpeed: Math.round(segRows[segRows.length - 1].v * 10) / 10,
                    type: currentTrend,
                    coords: segRows.map(r => [r.lat, r.lon])
                });
            }
            if (trendChanged && i < smoothed.length - 1) {
                segStart = endIdx;
                currentTrend = currentTrend === 'accel' ? 'decel' : 'accel';
                lastPeak = smoothed[segStart];
            }
        }
    }

    if (subSectors.length === 0) {
        subSectors.push({
            id: sectorId + '.1',
            startMeter: rows[0].s,
            endMeter: rows[rows.length - 1].s,
            entrySpeed: rows[0].v,
            exitSpeed: rows[rows.length - 1].v,
            type: 'flat',
            coords: rows.map(r => [r.lat, r.lon])
        });
    }
    return subSectors;
}

// Realtime CSV endpoint — güçlü PC bu adrese CSV gönderir
// Auth: requireAdmin middleware (admin session cookie'si gerekli)
app.post('/api/sectors/realtime-csv', requireAdmin, (req, res) => {
    // Body'yi metin olarak oku (express.text() middleware'i henüz eklenmemiş olabilir)
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
        // ── Parse ──
        const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) {
            return res.status(400).json({ error: 'CSV boş veya başlık yok' });
        }

        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''));
        const idxS = header.indexOf('s') !== -1 ? header.indexOf('s') : header.indexOf('zaman_ms');
        const idxLat = header.indexOf('lat');
        const idxLon = header.indexOf('lon');
        let idxV = header.indexOf('v_kmh');
        if (idxV < 0) idxV = header.indexOf('hiz_kmh');
        let idxSector = header.indexOf('sector');
        if (idxSector < 0) idxSector = header.indexOf('sectors');

        if (idxLat < 0 || idxLon < 0) {
            return res.status(400).json({ error: "CSV'de lat/lon sütunu bulunamadı" });
        }
        if (idxV < 0) {
            return res.status(400).json({ error: "CSV'de v_kmh veya hiz_kmh sütunu bulunamadı" });
        }

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < header.length) continue;
            const sVal = idxS >= 0 ? parseFloat(cols[idxS]) : i;
            const latVal = parseFloat(cols[idxLat]);
            const lonVal = parseFloat(cols[idxLon]);
            const vVal = parseFloat(cols[idxV]);
            if (isNaN(latVal) || isNaN(lonVal) || isNaN(vVal)) continue;

            let sectorVal;
            if (idxSector >= 0) {
                const raw = parseFloat(cols[idxSector]);
                sectorVal = isNaN(raw) ? 1 : Math.floor(raw);
            } else {
                sectorVal = -1;
            }
            rows.push({ s: sVal, lat: latVal, lon: lonVal, v: vVal, sector: sectorVal });
        }

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Geçerli satır bulunamadı' });
        }

        // Sector sütunu yoksa otomatik 7 eşit sektör
        if (rows[0].sector === -1) {
            const sMin = Math.min(...rows.map(r => r.s));
            const sMax = Math.max(...rows.map(r => r.s));
            const sectorWidth = (sMax - sMin) / 7;
            rows.forEach(r => {
                r.sector = Math.min(7, Math.floor((r.s - sMin) / sectorWidth) + 1);
            });
        }

        // Sektör haritası oluştur (alt-sektör destekli)
        const sectorRowsMap = {};
        rows.forEach(r => {
            if (!sectorRowsMap[r.sector]) sectorRowsMap[r.sector] = [];
            sectorRowsMap[r.sector].push(r);
        });

        const sectorNos = Object.keys(sectorRowsMap).map(Number).sort((a, b) => a - b);

        // sectors array (alt-sektörlerle birlikte)
        const sectors = sectorNos.map(no => {
            const sRows = sectorRowsMap[no].sort((a, b) => a.s - b.s);
            const subSectors = detectSubSectorsServer(sRows, no);
            return {
                id: no,
                startMeter: sRows[0].s,
                endMeter: sRows[sRows.length - 1].s,
                entrySpeed: Math.round(sRows[0].v * 10) / 10,
                exitSpeed: Math.round(sRows[sRows.length - 1].v * 10) / 10,
                subSectors: subSectors
            };
        });

        // optimumData
        const optimumData = rows.map(r => ({ s: Math.round(r.s), v: r.v }));

        // trackCoordinates
        const trackCoordinates = rows.map(r => [r.lat, r.lon]);

        // sectorCoordsArray
        const sectorCoords = {};
        sectorNos.forEach(no => {
            sectorCoords[no] = sectorRowsMap[no].map(r => [r.lat, r.lon]);
        });
        const sectorCoordsArray = sectorNos.map(no => ({ sectorId: no, coords: sectorCoords[no] }));

        // SSE payload
        const payload = {
            type: 'sector_update',
            sectors,
            optimumData,
            sectorCoordsArray,
            trackCoordinates,
            timestamp: Date.now(),
            rowCount: rows.length,
            sectorCount: sectorNos.length
        };

        broadcastSectorUpdate(payload);

        const totalSubs = sectors.reduce((sum, s) => sum + s.subSectors.length, 0);
        res.json({ success: true, rows: rows.length, sectors: sectorNos.length, subSectors: totalSubs, broadcast: raceSectorClients.size });

    } catch (err) {
        //console.error('Realtime CSV parse hatası:', err);
        res.status(500).json({ error: 'CSV işleme hatası: ' + err.message });
    }
});

// Realtime sector SSE stream — /race sayfası buraya subscribe olur
app.get('/api/sectors/realtime-stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    raceSectorClients.add(res);
    //console.log(`🔌 Race Sector SSE client bağlandı. Toplam: ${raceSectorClients.size}`);

    // Yeni bağlanan client'a en son sektör verisini hemen gönder
    if (lastRealtimeSectorPayload) {
        res.write(`data: ${JSON.stringify(lastRealtimeSectorPayload)}\n\n`);
    }

    // Heartbeat — bağlantıyı canlı tut
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        raceSectorClients.delete(res);
        // console.log(`🔌 Race Sector SSE client ayrıldı. Toplam: ${raceSectorClients.size}`);
    });
});


function serveStaticWithAuth(req, res, next) {
    const blockedFiles = ['/users.json', '/package.json', '/package-lock.json', '/server.js', '/create-user.js', '/clientmqtt.js', '/.env', '/node_modules', '/sectors.html', '/race.html', '/laps.html', '/play.html'];
    if (blockedFiles.some(blocked => req.path.startsWith(blocked))) {
        return res.status(403).send('Forbidden');
    }

    // Veri dizinlerine doğrudan erişim SADECE ADMIN için (dosya yolu ile indirme engeli)
    const adminOnlyDirs = ['/telemetry_data/', '/test_data/', '/races_data/', '/sectors_data/'];
    if (adminOnlyDirs.some(dir => req.path.startsWith(dir))) {
        if (req.session && req.session.userId && req.session.userRole === 'admin') {
            return next();
        }
        return res.status(403).json({ error: 'Bu dosyalara erişim için admin yetkisi gerekiyor' });
    }

    if (req.path.match(/\.(css|js|jpg|jpeg|gif|ico|svg)$/)) {
        if (req.session && req.session.userId) next();
        else res.status(401).send('Unauthorized');
    } else {
        next();
    }
}

app.use(serveStaticWithAuth, express.static(__dirname, { index: false, dotfiles: 'deny' }));

app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.redirect('/login');
    }
});

try { app.use(favicon(path.join(__dirname, 'logo.ico'))); } catch (e) { }

// ============================================
// SERVER BAŞLAT
// ============================================
app.listen(PORT, () => {
    //console.log(`\n Hidroana Telemetri Sunucusu Başlatıldı`);
    //console.log(`Adres: http://localhost:${PORT}`);
    //console.log(`Login: http://localhost:${PORT}/login`);
    //console.log(`Veri klasörü: ${DATA_DIR}\n`);
    initDataSource();
});

// Sunucu kapanırken bekleyen verileri kaydet (ASENKRON)
process.on('SIGINT', async () => {
    //console.log('\n⏹️ Sunucu kapatılıyor...');
    if (pendingData.length > 0 || testMode.pendingTestData.length > 0 || tubitakSession.pending.length > 0) {
        //console.log(`📝 ${pendingData.length} bekleyen veri kaydediliyor...`);
        await flushDataToFile();
        if (testMode.active) {
            await flushTestDataToFile();
        }
        await flushTubitakData(true); // force flush
    }
    //console.log('✅ Veriler kaydedildi. Çıkış yapılıyor...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (pendingData.length > 0) {
        await flushDataToFile();
    }
    if (testMode.active && testMode.pendingTestData.length > 0) {
        await flushTestDataToFile();
    }
    await flushTubitakData(true); // force flush
    process.exit(0);
});