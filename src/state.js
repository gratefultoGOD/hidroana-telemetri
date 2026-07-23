// ============================================
// PAYLAŞILAN UYGULAMA DURUMU (In-Memory State)
// Modüller arası döngüsel bağımlılığı önlemek için
// ortak mutable durum tek objede tutulur.
// ============================================
const config = require('./config');

const state = {
    // Son alınan telemetri verisi
    latestTelemetryData: null,

    // Her yeni veri geldiğinde artar (log throttling için de kullanılır)
    dataCounter: 0,

    // Bağlantı durumu
    connectionStatus: {
        source: config.DEFAULT_DATA_SOURCE,
        connected: false,
        lastUpdate: null,
        error: null
    },

    // URBAN aracı: son alınan telemetri verisi
    latestUrbanTelemetryData: null,

    // URBAN aracı veri sayacı
    urbanDataCounter: 0,

    // URBAN aracı bağlantı durumu
    urbanConnectionStatus: {
        source: 'MQTT',
        connected: false,
        lastUpdate: null,
        error: null
    },

    // Supercapacitor durumu (araç yanıtlarında kullanılır)
    supercapacitor: false,

    // Aktif araç modu: 'proto' | 'urban' — ayarlar sayfasından seçilir,
    // gelen 'data' string'inin hangi formatta parse edileceğini belirler
    activeVehicle: 'proto'
};

module.exports = state;
