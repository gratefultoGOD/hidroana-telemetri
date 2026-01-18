const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;  // Asenkron dosya işlemleri için
const mqtt = require('mqtt');
const favicon = require('serve-favicon');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// VERI KAYNAĞI AYARLARI (MQTT veya HTTP)
// ============================================
let DATA_SOURCE = process.env.DATA_SOURCE || 'HTTP'; // 'MQTT' veya 'HTTP'

// MQTT Configuration
const MQTT_BROKER_URL = 'mqtt://45.94.4.153:1883';
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

// HTTP Configuration (Araçtan veri alma - araç bize POST yapar)

// Son alınan telemetri verisi
let latestTelemetryData = null;
let key = '066c4e702e'
let dataCounter = 0; // Her yeni veri geldiğinde artar

// CSV dosya ayarları
const DATA_DIR = path.join(__dirname, 'telemetry_data');
const TEST_DIR = path.join(__dirname, 'test_data');
let pendingData = []; // Dosyaya yazılmayı bekleyen veriler
const FLUSH_THRESHOLD = 1; // Her veri geldiğinde hemen dosyaya yaz

// Test modu ayarları
let testMode = {
    active: false,
    startTime: null,
    testName: null,
    pendingTestData: []
};

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
const CSV_HEADERS = ['date', 'time', 'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];

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
        // Dosya yoksa başlık ekle
        const fileExists = fs.existsSync(filePath);

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
        console.log(`💾 ${dataToWrite.length} veri dosyaya yazıldı: ${fileName}`);
    } catch (error) {
        console.error('❌ Dosya yazma hatası:', error);
        // Hata durumunda verileri geri ekle
        pendingData = [...dataToWrite, ...pendingData];
    } finally {
        isFlushingData = false;
    }
}

// Test verilerini dosyaya yaz
const TEST_CSV_HEADERS = ['test_time', 'date', 'time', 'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];

let isFlushingTestData = false;  // Eşzamanlı yazma kontrolü

async function flushTestDataToFile() {
    if (!testMode.active || testMode.pendingTestData.length === 0) return;
    if (isFlushingTestData) return;

    isFlushingTestData = true;

    const dataToWrite = [...testMode.pendingTestData];
    testMode.pendingTestData = [];

    const filePath = path.join(TEST_DIR, testMode.testName);

    try {
        const fileExists = fs.existsSync(filePath);

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
        console.log(`🧪 ${dataToWrite.length} test verisi kaydedildi: ${testMode.testName}`);
    } catch (error) {
        console.error('Test dosyası yazma hatası:', error);
        testMode.pendingTestData = [...dataToWrite, ...testMode.pendingTestData];
    } finally {
        isFlushingTestData = false;
    }
}

// Test dosyalarının listesini al
function getTestFiles() {
    if (!fs.existsSync(TEST_DIR)) return [];

    const files = fs.readdirSync(TEST_DIR)
        .filter(f => f.endsWith('.csv'))
        .map(f => {
            const filePath = path.join(TEST_DIR, f);
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            const dataCount = Math.max(0, lines.length - 1);

            // Dosya adından tarih ve saat bilgisini çıkar
            // Format: test_DD-MM-YYYY_HH-MM-SS.csv
            const match = f.match(/test_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})\.csv/);
            let dateStr = '', timeStr = '';
            if (match) {
                dateStr = match[1];
                timeStr = match[2].replace(/-/g, ':');
            }

            return {
                fileName: f,
                date: dateStr,
                time: timeStr,
                dataCount: dataCount,
                fileSize: stats.size,
                lastModified: stats.mtime
            };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

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

// Tüm günlerin listesini al
function getAvailableDays() {
    if (!fs.existsSync(DATA_DIR)) return [];

    const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('_verileri.csv'))
        .map(f => {
            const filePath = path.join(DATA_DIR, f);
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            const dataCount = Math.max(0, lines.length - 1);

            // Dosya adından tarihi çıkar (DD-MM-YYYY_verileri.csv)
            const datePart = f.replace('_verileri.csv', '');

            return {
                fileName: f,
                date: datePart,
                dataCount: dataCount,
                fileSize: stats.size,
                lastModified: stats.mtime
            };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

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

// Ortalama hesaplama fonksiyonu (sadece son 15 saniye için)
function calculateAverages() {
    const now = Date.now();
    const fifteenSecondsAgo = now - RECENT_DATA_WINDOW;

    // Eski verileri temizle
    recentData = recentData.filter(d => d.timestamp >= fifteenSecondsAgo);

    const averages = {
        allTime: {}, // Artık dosyadan hesaplanmıyor, sadece bugünkü veri sayısı
        last15Seconds: {},
        allTimeCount: getTodayDataCount() + pendingData.length,
        last15SecondsCount: recentData.length
    };

    numericFields.forEach(field => {
        // Son 15 saniye ortalaması
        const recentValues = recentData.map(d => parseFloat(d[field])).filter(v => !isNaN(v));
        averages.last15Seconds[field] = recentValues.length > 0
            ? (recentValues.reduce((a, b) => a + b, 0) / recentValues.length).toFixed(2)
            : null;

        // Genel ortalama artık hesaplanmıyor (bellek tasarrufu)
        averages.allTime[field] = null;
    });

    return averages;
}

// Yıldız ile ayrılmış veriyi JSON'a dönüştür
const dataFields = ['h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];

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

    latestTelemetryData = dataWithTimestamp; // Sonra güncelle

    // Son 15 saniye verilerine ekle (ortalama için)
    recentData.push(dataWithTimestamp);

    // Dosyaya yazılacak verilere ekle
    pendingData.push(dataWithTimestamp);

    // 5 veri birikince dosyaya yaz
    if (pendingData.length >= FLUSH_THRESHOLD) {
        flushDataToFile();
    }

    // Test modu aktifse test verilerini de kaydet
    if (testMode.active && testMode.startTime) {
        const elapsedMs = now.getTime() - testMode.startTime;
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

    connectionStatus.connected = true;
    connectionStatus.lastUpdate = now.toISOString();
    connectionStatus.error = null;

    const speed = latestTelemetryData.h || 'N/A';
    const soc = latestTelemetryData.soc || 'N/A';
    const todayCount = getTodayDataCount() + pendingData.length;
    const testInfo = testMode.active ? ' | 🧪 TEST AKTİF' : '';
    console.log(`📥 [${DATA_SOURCE}] Veri alındı (#${dataCounter}): Hız=${speed} km/h, SOC=${soc}% | Bugün: ${todayCount} | Bekleyen: ${pendingData.length}${testInfo}`);
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
    console.log('MQTT broker bağlanılıyor...');
    mqttClient = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        console.log('MQTT broker bağlandı!');
        connectionStatus.connected = true;
        mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
            if (error) {
                console.error('Topice abone olma hatası:', error);
            } else {
                console.log(`📡 Topice abone olundu: ${MQTT_TOPIC}`);
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const rawMessage = message.toString().trim();
            console.log(' HAM VERİ:', rawMessage);
            const data = parseStarSeparatedData(rawMessage);
            processIncomingData(data);
        } catch (error) {
            console.error('Mesaj parse hatası:', error);
            console.error(' Ham veri:', message.toString());
        }
    });

    mqttClient.on('error', (error) => {
        console.error('MQTT bağlantı hatası:', error.message);
        connectionStatus.connected = false;
        connectionStatus.error = error.message;
    });

    mqttClient.on('offline', () => {
        console.log(' MQTT bağlantısı kesildi');
        connectionStatus.connected = false;
    });

    mqttClient.on('reconnect', () => {
        console.log('MQTT yeniden bağlanıyor...');
    });
}

function stopMQTT() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        console.log(' MQTT bağlantısı kapatıldı');
    }
}

// ============================================
// HTTP MODE (Araç bize GET isteği yapar)
// ============================================
let httpModeActive = false;
let supercapacitor = false;

function startHTTP() {
    httpModeActive = true;
    console.log('HTTP modu aktif - Araçtan veri bekleniyor...');
    console.log('Endpoint: GET /api/telemetry?h=...&x=...&y=...');
}

function stopHTTP() {
    httpModeActive = false;
    console.log('HTTP modu kapatıldı');
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

    console.log(`Veri kaynağı değiştirildi: ${newSource}`);
    return { success: true, message: `Veri kaynağı ${newSource} olarak değiştirildi` };
}

// Başlangıçta veri kaynağını başlat
function initDataSource() {
    console.log(`\n Veri kaynağı: ${DATA_SOURCE}`);
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
        console.log('⚠️ Unauthorized access detected');
        return res.status(401).send('UNAUTHORIZED');
    }

    // ÖNCE CEVABI GÖNDER - minimum latency için kritik
    res.removeHeader('X-Powered-By');
    res.setHeader('Content-Length', 1);
    res.status(200).send(supercapacitor ? '1' : '0');

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
            id: q.id || null,
            //key: q.key || null
        };

        processIncomingData(data);
        console.log(`⚡ /data response: ${durationMs.toFixed(2)}ms | Hız=${data.h}`);
    });
});

// ============================================
// EXPRESS MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        console.error('Kullanıcılar yüklenirken hata:', error);
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
        res.json({ success: true, message: 'Giriş başarılı', user: { id: user.id, username: user.username } });
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
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        res.json({ authenticated: false });
    }
});

// Telemetri endpoints
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
        console.log(`⚠️ Veri akışı kesildi (${timeSinceLastData}ms önce)`);
        return res.status(503).json({
            error: 'Veri akışı kesildi',
            lastDataTime: lastDataTime,
            timeSinceLastData: timeSinceLastData
        });
    }

    res.json(latestTelemetryData);
});

app.get('/api/telemetry/count', requireAuth, (req, res) => {
    const todayCount = getTodayDataCount() + pendingData.length;
    const days = getAvailableDays();

    res.json({
        count: todayCount,
        pendingCount: pendingData.length,
        todayFile: getDailyFileName(),
        availableDays: days.length
    });
});

app.get('/api/telemetry/averages', requireAuth, (req, res) => {
    res.json(calculateAverages());
});

// Mevcut günlerin listesi
app.get('/api/telemetry/days', requireAuth, (req, res) => {
    const days = getAvailableDays();
    res.json({ days });
});

// ============================================
// TEST MODU API ENDPOINTS
// ============================================

// Test başlat
app.post('/api/test/start', requireAuth, (req, res) => {
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

    console.log(`Test başlatıldı: ${testMode.testName}`);

    res.json({
        success: true,
        message: 'Test başlatıldı',
        testName: testMode.testName,
        startTime: now.toISOString()
    });
});

// Test durdur
app.post('/api/test/stop', requireAuth, (req, res) => {
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
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        dataCount = Math.max(0, lines.length - 1);
    }

    console.log(`Test durduruldu: ${testName} | Süre: ${formatTestTime(duration)} | Veri: ${dataCount}`);

    testMode.active = false;
    testMode.startTime = null;
    testMode.testName = null;
    testMode.pendingTestData = [];

    res.json({
        success: true,
        message: 'Test durduruldu',
        testName: testName,
        duration: formatTestTime(duration),
        durationMs: duration,
        dataCount: dataCount
    });
});

// Test durumu
app.get('/api/test/status', requireAuth, (req, res) => {
    if (!testMode.active) {
        return res.json({
            active: false
        });
    }

    const elapsed = Date.now() - testMode.startTime;

    res.json({
        active: true,
        testName: testMode.testName,
        startTime: new Date(testMode.startTime).toISOString(),
        elapsed: elapsed,
        elapsedFormatted: formatTestTime(elapsed),
        pendingData: testMode.pendingTestData.length
    });
});

// Test dosyalarını listele
app.get('/api/test/files', requireAuth, (req, res) => {
    const files = getTestFiles();
    res.json({ files });
});

// Test dosyasını indir
app.get('/api/test/download/:fileName', requireAuth, (req, res) => {
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
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
});

// Test dosyasını sil
app.delete('/api/test/delete/:fileName', requireAuth, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('.csv') || fileName.includes('..') || fileName.includes('/')) {
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

// Belirli bir günün verisini indir
app.get('/api/telemetry/download/:fileName', requireAuth, (req, res) => {
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
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
});

// Bugünün verisini indir (bekleyen veriler dahil)
app.get('/api/telemetry/download-today', requireAuth, (req, res) => {
    // Önce bekleyen verileri dosyaya yaz
    flushDataToFile();

    const fileName = getDailyFileName();
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Bugün henüz veri toplanmadı' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
});

// Belirli bir günün verisini sil
app.delete('/api/telemetry/delete/:fileName', requireAuth, (req, res) => {
    const fileName = req.params.fileName;

    if (!fileName.endsWith('_verileri.csv') || fileName.includes('..') || fileName.includes('/')) {
        return res.status(400).json({ error: 'Geçersiz dosya adı' });
    }

    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ Dosya silindi: ${fileName}`);
    res.json({ success: true, message: `${fileName} silindi` });
});

app.delete('/api/telemetry/clear', requireAuth, (req, res) => {
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



app.get('/capacitor', requireAuth, (req, res) => {
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


// CSV export - Tüm günlerin verilerini birleştir
app.get('/api/telemetry/csv', requireAuth, (req, res) => {
    // Önce bekleyen verileri dosyaya yaz
    flushDataToFile();

    const days = getAvailableDays();

    if (days.length === 0) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }

    let csv = '\uFEFF' + CSV_HEADERS.join(';') + '\n';

    // Tüm dosyaları birleştir
    days.forEach(day => {
        const filePath = path.join(DATA_DIR, day.fileName);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        // İlk satır (başlık) hariç ekle
        lines.slice(1).forEach(line => {
            if (line.trim()) csv += line + '\n';
        });
    });

    const filename = `telemetry_tum_veriler_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
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

app.post('/api/source/switch', requireAuth, (req, res) => {
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

function serveStaticWithAuth(req, res, next) {
    const blockedFiles = ['/users.json', '/package.json', '/package-lock.json', '/server.js', '/create-user.js', '/clientmqtt.js', '/.env', '/node_modules'];
    if (blockedFiles.some(blocked => req.path.startsWith(blocked))) {
        return res.status(403).send('Forbidden');
    }
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/)) {
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
    console.log(`\n Hidroana Telemetri Sunucusu Başlatıldı`);
    console.log(`Adres: http://localhost:${PORT}`);
    console.log(`Login: http://localhost:${PORT}/login`);
    console.log(`Veri klasörü: ${DATA_DIR}\n`);
    initDataSource();
});

// Sunucu kapanırken bekleyen verileri kaydet (ASENKRON)
process.on('SIGINT', async () => {
    console.log('\n⏹️ Sunucu kapatılıyor...');
    if (pendingData.length > 0 || testMode.pendingTestData.length > 0) {
        console.log(`📝 ${pendingData.length} bekleyen veri kaydediliyor...`);
        await flushDataToFile();
        if (testMode.active) {
            await flushTestDataToFile();
        }
    }
    console.log('✅ Veriler kaydedildi. Çıkış yapılıyor...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (pendingData.length > 0) {
        await flushDataToFile();
    }
    if (testMode.active && testMode.pendingTestData.length > 0) {
        await flushTestDataToFile();
    }
    process.exit(0);
});
