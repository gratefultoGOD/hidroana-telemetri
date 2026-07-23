// ============================================
// UYGULAMA YAPILANDIRMASI
// Tüm sabitler ve ayarlar tek yerde toplanır.
// ============================================
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

// Telemetri verisindeki alan sırası (yıldız ile ayrılmış ham veri)
const DATA_FIELDS = [
    'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit',
    'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke',
    'jv', 'jc', 'jw', 'jwh', 'mt', 'watt', 'ppm',
    'gx', 'gy', 'gz', 'ax', 'ay', 'az',
    'flow', 'totalflow', 'gsmspeed', 'pitch', 'roll', 'yaw',
    'driver_pot', 'direksiyon_angle'
];

// Günlük CSV başlıkları: tarih/saat + telemetri alanları + gerçek flow değerleri
const CSV_HEADERS = ['date', 'time', ...DATA_FIELDS, 'realInstantFlow', 'realTotalFlow'];

// Test CSV başlıkları: başa test süresi eklenir
const TEST_CSV_HEADERS = ['test_time', ...CSV_HEADERS];

// Ortalama hesaplamasında kullanılan sayısal alanlar
const NUMERIC_FIELDS = [
    'h', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit',
    'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3',
    'soc', 'ke', 'jv', 'jc', 'jw', 'jwh'
];

// URBAN aracı: aynı alan sırasının bir alt kümesi + sona eklenen
// gsmspeed ve T_tank_C (tank sıcaklığı — string'in en sonunda gelir)
// (mt, watt, ppm, gx/gy/gz, ax/ay/az, flow, totalflow, pitch/roll/yaw,
//  driver_pot, direksiyon_angle URBAN string'inde yok)
const URBAN_DATA_FIELDS = [
    'h', 'x', 'y', 'gs', 'fv', 'fa', 'fw', 'fet', 'fit',
    'bv', 'bc', 'bw', 'bwh', 't1', 't2', 't3', 'soc', 'ke',
    'jv', 'jc', 'jw', 'jwh', 'gsmspeed', 'T_tank_C'
];

const URBAN_CSV_HEADERS = ['date', 'time', ...URBAN_DATA_FIELDS];

// URBAN test CSV başlıkları: başa test süresi eklenir
const URBAN_TEST_CSV_HEADERS = ['test_time', ...URBAN_CSV_HEADERS];

// URBAN ortalama hesaplamasında kullanılan sayısal alanlar
// (NUMERIC_FIELDS + tank sıcaklığı T_tank_C)
const URBAN_NUMERIC_FIELDS = [...NUMERIC_FIELDS, 'T_tank_C'];

module.exports = {
    ROOT_DIR,
    PORT: process.env.PORT || 3000,

    // Veri kaynağı: 'MQTT' veya 'HTTP'
    DEFAULT_DATA_SOURCE: process.env.DATA_SOURCE || 'MQTT',

    // MQTT ayarları
    MQTT_BROKER_URL: 'mqtt://213.142.148.28:1883',
    MQTT_OPTIONS: {
        username: 'hidroana',
        password: 'hidro2626'
    },
    MQTT_TOPIC: 'data',
    MQTT_FLOW_TOPIC: 'flow',
    MQTT_TAKE: 'take',

    // HTTP modu API anahtarı (/data endpoint'i)
    API_KEY: '066c4e702e',

    // Veri dizinleri
    DATA_DIR: path.join(ROOT_DIR, 'telemetry_data'),
    TEST_DIR: path.join(ROOT_DIR, 'test_data'),
    SECTORS_DIR: path.join(ROOT_DIR, 'sectors_data'),
    RACES_DIR: path.join(ROOT_DIR, 'races_data'),
    TUBITAK_DIR: path.join(ROOT_DIR, 'tubitak_data'),
    URBAN_DATA_DIR: path.join(ROOT_DIR, 'urban_data'),
    USERS_FILE: path.join(ROOT_DIR, 'users.json'),

    // Flush eşikleri (event loop koruması: N veri birikince dosyaya yaz)
    FLUSH_THRESHOLD: 5,
    TUBITAK_FLUSH_THRESHOLD: 5,

    // Flow eşleştirme ayarları
    FLOW_MATCH_WINDOW: 5000,  // Eşleştirme penceresi: 5 saniye
    FLOW_BUFFER_MAX: 200,     // Maksimum buffer boyutu

    // Son N ms'nin verileri bellekte tutulur (ortalama hesaplama için)
    RECENT_DATA_WINDOW: 15000,

    // SSE: yeni bağlanan client'a gönderilecek son verinin maksimum yaşı
    SSE_STALE_THRESHOLD_MS: 25000,

    // TÜBİTAK: bu süreden uzun veri boşluğunda yeni dosya başlatılır
    TUBITAK_GAP_MS: 60000,

    // Session
    SESSION_SECRET: process.env.SESSION_SECRET
        || 'hidroana-telemetri-secret-key-2024-' + Math.random().toString(36),

    // CSV alan tanımları
    DATA_FIELDS,
    CSV_HEADERS,
    TEST_CSV_HEADERS,
    NUMERIC_FIELDS,
    TUBITAK_HEADERS: 'zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_V;kalan_enerji_Wh',

    // URBAN aracı alan tanımları
    URBAN_DATA_FIELDS,
    URBAN_CSV_HEADERS,
    URBAN_TEST_CSV_HEADERS,
    URBAN_NUMERIC_FIELDS
};
