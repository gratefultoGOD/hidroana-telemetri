// ============================================
// SİSTEM AYARLARI SERVİSİ
// Aktif araç (proto/urban) ve veri kanalı (MQTT/HTTP) tercihini
// vehicle_settings.json dosyasında kalıcı olarak tutar, sunucu
// yeniden başlatıldığında aynı moda dönmesini sağlar.
// ============================================
const fs = require('fs');
const path = require('path');

const { ROOT_DIR } = require('../config');
const state = require('../state');

const SETTINGS_FILE = path.join(ROOT_DIR, 'vehicle_settings.json');

// Kalıcı ayarları dosyadan oku, state.activeVehicle'ı günceller.
// Sunucu başlangıcında dataSource.initDataSource()'dan ÖNCE çağrılmalı.
function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return null;
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.vehicle === 'proto' || parsed.vehicle === 'urban')) {
            state.activeVehicle = parsed.vehicle;
        }
        return parsed;
    } catch (e) {
        return null;
    }
}

// Ayarları dosyaya kaydet
function persistSettings(vehicle, channel) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ vehicle, channel }, null, 2), 'utf8');
    } catch (e) {
        // Kaydedilemedi — bir sonraki restart'ta varsayılana döner, kritik değil
    }
}

function setActiveVehicle(vehicle) {
    if (vehicle !== 'proto' && vehicle !== 'urban') {
        throw new Error('Geçersiz araç modu');
    }
    state.activeVehicle = vehicle;
}

function getActiveVehicle() {
    return state.activeVehicle;
}

module.exports = {
    loadSettings,
    persistSettings,
    setActiveVehicle,
    getActiveVehicle,
    SETTINGS_FILE
};
