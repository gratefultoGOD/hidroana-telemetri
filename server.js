// ============================================
// HİDROANA TELEMETRİ SUNUCUSU
// Giriş noktası: Express app kurulumu, middleware zinciri,
// route mount'ları ve yaşam döngüsü yönetimi.
//
// Modül yapısı:
//   src/config.js               — tüm sabitler ve ayarlar
//   src/state.js                — paylaşılan in-memory durum
//   src/utils/                  — genel yardımcılar (dosya adı, süre, XLSX)
//   src/middleware/             — auth ve statik dosya kontrolü
//   src/services/               — iş mantığı (veri hattı, depolama, SSE, MQTT...)
//   src/routes/                 — Express route tanımları
// ============================================
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const favicon = require('serve-favicon');

const config = require('./src/config');
const telemetryStore = require('./src/services/telemetryStore');
const urbanTelemetryStore = require('./src/services/urbanTelemetryStore');
const testModeService = require('./src/services/testMode');
const tubitak = require('./src/services/tubitak');
const dataSource = require('./src/services/dataSource');
const systemSettings = require('./src/services/systemSettings');
const { serveStaticWithAuth } = require('./src/middleware/staticAuth');

const app = express();

// ============================================
// KALICI SİSTEM AYARLARINI GERİ YÜKLE (araç + kanal)
// initDataSource()'dan ÖNCE çalışmalı — aksi halde ilk bağlantı
// yanlış kanalla açılır
// ============================================
const persistedSettings = systemSettings.loadSettings();
if (persistedSettings && persistedSettings.channel) {
    dataSource.setInitialSource(persistedSettings.channel);
}
console.log(`⚙️ Aktif araç: ${systemSettings.getActiveVehicle()}, kanal: ${dataSource.getDataSource()}`);

// ============================================
// VERİ DİZİNLERİNİ OLUŞTUR
// ============================================
[config.DATA_DIR, config.TEST_DIR, config.SECTORS_DIR, config.RACES_DIR, config.TUBITAK_DIR, config.URBAN_DATA_DIR]
    .forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

// ============================================
// BAŞLANGIÇ HAZIRLIKLARI
// ============================================
// Günlük ortalamaları bugünün dosyasından hesapla
telemetryStore.initDailyAverages();
console.log(`📊 initDailyAverages: count=${telemetryStore.getDailyAveragesCount()}, fv_avg=${telemetryStore.getDailyAverages().fv?.toFixed(4)}`);

// URBAN aracı günlük ortalamaları
urbanTelemetryStore.initDailyAverages();
console.log(`📊 [URBAN] initDailyAverages: count=${urbanTelemetryStore.getDailyAveragesCount()}`);

// Gün sayısı cache'ini başlat ve her 60 saniyede güncelle
telemetryStore.updateAvailableDaysCount();
setInterval(telemetryStore.updateAvailableDaysCount, 60000);

urbanTelemetryStore.updateAvailableDaysCount();
setInterval(urbanTelemetryStore.updateAvailableDaysCount, 60000);

// ============================================
// /data ENDPOINT (Middleware'lerden ÖNCE)
// 2G GSM için minimum gecikme - middleware bypass
// ============================================
const sourceRoutes = require('./src/routes/source');
app.use(sourceRoutes.dataRouter);

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
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'strict'
    }
}));

// ============================================
// ROUTES
// ============================================
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/settings'));
app.use(require('./src/routes/telemetry'));
app.use(require('./src/routes/urbanTelemetry'));
app.use(require('./src/routes/test'));
app.use(require('./src/routes/tubitak'));
app.use(require('./src/routes/laps'));
app.use(require('./src/routes/sectors'));
app.use(sourceRoutes.router);
app.use(require('./src/routes/pages'));

// ============================================
// STATİK DOSYALAR
// ============================================
app.use(serveStaticWithAuth, express.static(__dirname, { index: false, dotfiles: 'deny' }));

try { app.use(favicon(path.join(__dirname, 'logo.ico'))); } catch (e) { }

// ============================================
// SERVER BAŞLAT
// ============================================
app.listen(config.PORT, () => {
    console.log(`\n Hidroana Telemetri Sunucusu Başlatıldı`);
    console.log(`Adres: http://localhost:${config.PORT}`);
    console.log(`Login: http://localhost:${config.PORT}/login`);
    console.log(`Veri klasörü: ${config.DATA_DIR}\n`);
    dataSource.initDataSource();
});

// ============================================
// KAPANIŞ: bekleyen verileri kaydet (ASENKRON)
// ============================================
async function flushAllPending() {
    await telemetryStore.flushDataToFile();
    await urbanTelemetryStore.flushDataToFile();
    if (testModeService.testMode.active) {
        await testModeService.flushTestDataToFile();
    }
    await tubitak.flushTubitakData(true); // force flush
}

process.on('SIGINT', async () => {
    console.log('\n⏹️ Sunucu kapatılıyor...');
    console.log(`📝 ${telemetryStore.getPendingCount() + urbanTelemetryStore.getPendingCount()} bekleyen veri kaydediliyor...`);
    await flushAllPending();
    console.log('✅ Veriler kaydedildi. Çıkış yapılıyor...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await flushAllPending();
    process.exit(0);
});
