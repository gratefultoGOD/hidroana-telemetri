const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const mqtt = require('mqtt');
const favicon = require('serve-favicon');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// VERI KAYNAĞI AYARLARI (MQTT veya HTTP)
// ============================================
let DATA_SOURCE = process.env.DATA_SOURCE || 'MQTT'; // 'MQTT' veya 'HTTP'

// MQTT Configuration
const MQTT_BROKER_URL = 'mqtt://45.94.4.153:2341';
const MQTT_OPTIONS = {
    username: 'hidroana',
    password: 'hidro2626'
};
const MQTT_TOPIC = 'data';

// HTTP Configuration (Araçtan veri alma - araç bize POST yapar)

// Son alınan telemetri verisi
let latestTelemetryData = null;

// Tüm telemetri verilerini sakla (CSV için)
let allTelemetryData = [];
const MAX_DATA_POINTS = 100000;

// Bağlantı durumu
let connectionStatus = {
    source: DATA_SOURCE,
    connected: false,
    lastUpdate: null,
    error: null
};

// Ortalama hesaplama için veri alanları
const numericFields = ['h', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];

// Ortalama hesaplama fonksiyonu
function calculateAverages() {
    const now = Date.now();
    const fifteenSecondsAgo = now - 15000;
    const recentData = allTelemetryData.filter(d => d.timestamp >= fifteenSecondsAgo);
    
    const averages = {
        allTime: {},
        last15Seconds: {},
        allTimeCount: allTelemetryData.length,
        last15SecondsCount: recentData.length
    };
    
    numericFields.forEach(field => {
        const allValues = allTelemetryData.map(d => parseFloat(d[field])).filter(v => !isNaN(v));
        averages.allTime[field] = allValues.length > 0 
            ? (allValues.reduce((a, b) => a + b, 0) / allValues.length).toFixed(2) 
            : null;
        
        const recentValues = recentData.map(d => parseFloat(d[field])).filter(v => !isNaN(v));
        averages.last15Seconds[field] = recentValues.length > 0 
            ? (recentValues.reduce((a, b) => a + b, 0) / recentValues.length).toFixed(2) 
            : null;
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
    latestTelemetryData = data;
    
    const now = new Date();
    const dataWithTimestamp = {
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0'),
        timestamp: now.getTime(),
        ...latestTelemetryData
    };
    
    allTelemetryData.push(dataWithTimestamp);
    
    if (allTelemetryData.length > MAX_DATA_POINTS) {
        allTelemetryData = allTelemetryData.slice(-MAX_DATA_POINTS);
    }
    
    connectionStatus.connected = true;
    connectionStatus.lastUpdate = now.toISOString();
    connectionStatus.error = null;
    
    const speed = latestTelemetryData.h || 'N/A';
    const soc = latestTelemetryData.soc || 'N/A';
    console.log(`📥 [${DATA_SOURCE}] Veri alındı: Hız=${speed} km/h, SOC=${soc}% | Toplam: ${allTelemetryData.length}`);
}

// ============================================
// MQTT BAĞLANTISI
// ============================================
let mqttClient = null;

function startMQTT() {
    console.log('🔌 MQTT broker\'a bağlanılıyor...');
    mqttClient = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);
    
    mqttClient.on('connect', () => {
        console.log('✅ MQTT broker\'a bağlandı!');
        connectionStatus.connected = true;
        mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
            if (error) {
                console.error('❌ Topic\'e abone olma hatası:', error);
            } else {
                console.log(`📡 Topic\'e abone olundu: ${MQTT_TOPIC}`);
            }
        });
    });
    
    mqttClient.on('message', (topic, message) => {
        try {
            const rawMessage = message.toString().trim();
            console.log('📦 HAM VERİ:', rawMessage);
            const data = parseStarSeparatedData(rawMessage);
            processIncomingData(data);
        } catch (error) {
            console.error('❌ Mesaj parse hatası:', error);
            console.error('📝 Ham veri:', message.toString());
        }
    });
    
    mqttClient.on('error', (error) => {
        console.error('❌ MQTT bağlantı hatası:', error.message);
        connectionStatus.connected = false;
        connectionStatus.error = error.message;
    });
    
    mqttClient.on('offline', () => {
        console.log('⚠️  MQTT bağlantısı kesildi');
        connectionStatus.connected = false;
    });
    
    mqttClient.on('reconnect', () => {
        console.log('🔄 MQTT yeniden bağlanıyor...');
    });
}

function stopMQTT() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        console.log('🔌 MQTT bağlantısı kapatıldı');
    }
}

// ============================================
// HTTP MODE (Araç bize POST yapar)
// ============================================
let httpModeActive = false;

function startHTTP() {
    httpModeActive = true;
    console.log('🌐 HTTP modu aktif - Araçtan veri bekleniyor...');
    console.log('📡 Endpoint: POST /api/vehicle/telemetry');
}

function stopHTTP() {
    httpModeActive = false;
    console.log('🌐 HTTP modu kapatıldı');
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
    
    console.log(`🔄 Veri kaynağı değiştirildi: ${newSource}`);
    return { success: true, message: `Veri kaynağı ${newSource} olarak değiştirildi` };
}

// Başlangıçta veri kaynağını başlat
function initDataSource() {
    console.log(`\n📊 Veri kaynağı: ${DATA_SOURCE}`);
    if (DATA_SOURCE === 'MQTT') {
        startMQTT();
    } else {
        startHTTP();
    }
}

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
    if (latestTelemetryData) {
        res.json(latestTelemetryData);
    } else {
        res.status(503).json({ error: 'Henüz veri alınmadı' });
    }
});

app.get('/api/telemetry/count', requireAuth, (req, res) => {
    res.json({ 
        count: allTelemetryData.length,
        maxCount: MAX_DATA_POINTS,
        oldestData: allTelemetryData.length > 0 ? allTelemetryData[0].date + ' ' + allTelemetryData[0].time : null,
        newestData: allTelemetryData.length > 0 ? allTelemetryData[allTelemetryData.length - 1].date + ' ' + allTelemetryData[allTelemetryData.length - 1].time : null
    });
});

app.get('/api/telemetry/averages', requireAuth, (req, res) => {
    res.json(calculateAverages());
});

app.delete('/api/telemetry/clear', requireAuth, (req, res) => {
    const clearedCount = allTelemetryData.length;
    allTelemetryData = [];
    console.log(`🗑️ Telemetri verileri temizlendi. Silinen kayıt: ${clearedCount}`);
    res.json({ success: true, clearedCount });
});

// ============================================
// ARAÇTAN VERİ ALMA ENDPOINT'İ (HTTP modu)
// ============================================
app.post('/api/vehicle/telemetry', (req, res) => {
    if (DATA_SOURCE !== 'HTTP') {
        return res.status(400).json({ error: 'HTTP modu aktif değil' });
    }
    
    try {
        const data = req.body;
        console.log('📦 HTTP VERİ:', JSON.stringify(data));
        processIncomingData(data);
        res.json({ success: true, message: 'Veri alındı' });
    } catch (error) {
        console.error('❌ HTTP veri işleme hatası:', error);
        res.status(500).json({ error: 'Veri işlenemedi' });
    }
});

// Araç için alternatif endpoint (star-separated format)
app.post('/api/vehicle/raw', (req, res) => {
    if (DATA_SOURCE !== 'HTTP') {
        return res.status(400).json({ error: 'HTTP modu aktif değil' });
    }
    
    try {
        const rawMessage = req.body.data || req.body.raw || '';
        console.log('📦 HTTP HAM VERİ:', rawMessage);
        const data = parseStarSeparatedData(rawMessage);
        processIncomingData(data);
        res.json({ success: true, message: 'Veri alındı' });
    } catch (error) {
        console.error('❌ HTTP veri işleme hatası:', error);
        res.status(500).json({ error: 'Veri işlenemedi' });
    }
});

// CSV export
app.get('/api/telemetry/csv', requireAuth, (req, res) => {
    if (allTelemetryData.length === 0) {
        return res.status(404).json({ error: 'Henüz veri toplanmadı' });
    }
    const headers = ['date', 'time', 'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit', 'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'];
    let csv = headers.join(';') + '\n';
    allTelemetryData.forEach(data => {
        const row = headers.map(h => data[h] !== undefined && data[h] !== null ? data[h] : '');
        csv += row.join(';') + '\n';
    });
    const filename = `telemetry_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
});

// ============================================
// VERI KAYNAGI API (MQTT/HTTP geçişi)
// ============================================
app.get('/api/source/status', requireAuth, (req, res) => {
    res.json(connectionStatus);
});

app.post('/api/source/switch', requireAuth, (req, res) => {
    const { source } = req.body;
    const result = switchDataSource(source);
    res.json(result);
});

app.get('/api/source/config', requireAuth, (req, res) => {
    res.json({
        currentSource: DATA_SOURCE,
        mqtt: {
            brokerUrl: MQTT_BROKER_URL,
            topic: MQTT_TOPIC
        },
        http: {
            endpoint: '/api/vehicle/telemetry',
            description: 'Araç bu endpoint\'e POST yapar'
        }
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

try { app.use(favicon(path.join(__dirname, 'logo.ico'))); } catch (e) {}

// ============================================
// SERVER BAŞLAT
// ============================================
app.listen(PORT, () => {
    console.log(`\n🚀 Hidroana Telemetri Sunucusu Başlatıldı`);
    console.log(`📍 Adres: http://localhost:${PORT}`);
    console.log(`🔐 Login: http://localhost:${PORT}/login\n`);
    initDataSource();
});
