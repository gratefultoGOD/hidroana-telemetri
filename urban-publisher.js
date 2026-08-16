// URBAN Publisher - Simulated URBAN vehicle telemetry generator
// Aracın gerçek broker'ına (config.js) bağlanır ve 'data' topic'ine
// URBAN_DATA_FIELDS formatında sahte veri gönderir.
//
// NOT: Sunucu tek bir 'data' topic'ini dinler; gelen string'in URBAN mı
// PROTO mu olduğu /settings sayfasında seçilen aktif araca göre yorumlanır.
// Bu script'i çalıştırmadan önce tarayıcıda /settings sayfasından
// "Urban" + "MQTT" seçip kaydettiğinizden emin olun — aksi halde sunucu
// bu veriyi PROTO formatıyla parse etmeye çalışır ve alanlar kayar.
const mqtt = require('mqtt');
const config = require('./src/config');

const TOPIC = config.MQTT_TOPIC; // 'data' — sunucunun dinlediği tek topic
const TAKE_TOPIC = config.MQTT_TAKE;
const SEND_INTERVAL_MS = parseInt(process.env.SEND_INTERVAL) || 1000;
const ERROR_HOLD_TICKS = Math.max(1, parseInt(process.env.ERROR_HOLD_TICKS) || 3);

const KELLY_ERROR_TESTS = [
    { code: 0, label: 'Hata yok' },
    { code: 1, label: 'ERR0: Identification error' },
    { code: 2, label: 'ERR1: Over voltage' },
    { code: 4, label: 'ERR2: Low voltage' },
    { code: 8, label: 'ERR3: Reserved' },
    { code: 16, label: 'ERR4: Stall' },
    { code: 32, label: 'ERR5: Internal volts fault' },
    { code: 64, label: 'ERR6: Over temperature' },
    { code: 128, label: 'ERR7: Throttle error at power-up' },
    { code: 256, label: 'ERR8: Reserved' },
    { code: 512, label: 'ERR9: Internal reset' },
    { code: 1024, label: 'ERR10: Hall throttle is open or short-circuit' },
    { code: 2048, label: 'ERR11: Angle sensor error' },
    { code: 4096, label: 'ERR12: Reserved' },
    { code: 8192, label: 'ERR13: Reserved' },
    { code: 16384, label: 'ERR14: Motor over-temperature' },
    { code: 32768, label: 'ERR15: Hall Galvanometer sensor error' },
    {
        code: 1,
        label: 'Kelly ERR0 + Araç Kontrol Sistemi hata alanları testi',
        vehicleControlErrorCodes: [2, 32, 16384]
    }
];

// Route coordinates (test amaçlı basit bir döngü)
const route = [
    [41.0151, 28.9795], [41.0161, 28.9805], [41.0171, 28.9815],
    [41.0181, 28.9825], [41.0191, 28.9835], [41.0201, 28.9845],
    [41.0211, 28.9855], [41.0221, 28.9865], [41.0231, 28.9875],
    [41.0241, 28.9885], [41.0251, 28.9895], [41.0261, 28.9905]
];

let routeIndex = 0;
let direction = 1;

// Simulated values with realistic variations
let simState = {
    soc: 85,
    ke: 45,
    bwh: 100,
    tank: 30,   // Hidrojen tank sıcaklığı (°C) — yumuşak değişim için
    tick: 0
};

console.log('🔌 URBAN publisher — MQTT broker\'a bağlanılıyor...');
const client = mqtt.connect(config.MQTT_BROKER_URL, config.MQTT_OPTIONS);

client.on('connect', () => {
    client.subscribe(TAKE_TOPIC, { qos: 1 });
    console.log('✅ MQTT broker\'a bağlandı!');
    console.log(`📡 Topic: ${TOPIC} (URBAN formatında)`);
    console.log(`📊 Veri formatı: ${config.URBAN_DATA_FIELDS.join(', ')}`);
    console.log(`⏱️  Gönderim aralığı: ${SEND_INTERVAL_MS}ms`);
    console.log(`🧪 Kelly + AKS hata testi: ${KELLY_ERROR_TESTS.length} durum, durum başına ${ERROR_HOLD_TICKS} gönderim`);
    console.log('⚠️  /settings sayfasında "Urban" + "MQTT" seçili olduğundan emin olun!\n');

    sendTelemetryData();
    setInterval(sendTelemetryData, SEND_INTERVAL_MS);
});

client.on('message', (topic, message) => {
    if (topic === TAKE_TOPIC) {
        console.log('Supercapacitor:', message.toString());
    }
});

client.on('error', (error) => {
    console.error('❌ MQTT bağlantı hatası:', error.message);
});

client.on('offline', () => {
    console.log('⚠️  MQTT bağlantısı kesildi, yeniden bağlanılıyor...');
});

client.on('reconnect', () => {
    console.log('🔄 MQTT yeniden bağlanıyor...');
});

// Helper functions
function randomInRange(min, max, decimals = 0) {
    const value = Math.random() * (max - min) + min;
    return decimals > 0 ? parseFloat(value.toFixed(decimals)) : Math.floor(value);
}

function varyValue(base, variance, min, max) {
    const newValue = base + (Math.random() - 0.5) * variance;
    return Math.max(min, Math.min(max, newValue));
}

function formatChargeTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function sendTelemetryData() {
    // Move along route
    if (routeIndex >= route.length - 1) direction = -1;
    else if (routeIndex <= 0) direction = 1;
    routeIndex += direction;

    const position = route[routeIndex];

    // Update simulated state
    simState.tick++;
    const phase = simState.tick % 48;
    const isCharging = phase >= 30 && phase < 40;
    const controllerEnabled = phase < 44;
    const driveDirection = phase < 16 ? 2 : phase < 26 ? 1 : phase < 42 ? 0 : 2;
    const errorTestIndex = Math.floor((simState.tick - 1) / ERROR_HOLD_TICKS) % KELLY_ERROR_TESTS.length;
    const activeErrorTest = KELLY_ERROR_TESTS[errorTestIndex];
    const vehicleControlErrorCodes = activeErrorTest.vehicleControlErrorCodes || [0, 0, 0];

    simState.soc = isCharging
        ? Math.min(100, simState.soc + 0.35)
        : varyValue(simState.soc, 1.2, 10, 100);
    simState.ke = isCharging
        ? Math.min(60, simState.ke + 0.2)
        : varyValue(simState.ke, 0.7, 5, 60);
    simState.bwh += randomInRange(0.1, 0.5, 1);
    simState.tank = varyValue(simState.tank, 1.5, 15, 55);

    // config.js convention: raw 'x' alanı enlem (lat), raw 'y' alanı boylam (lng)
    const telemetryData = {
        h: String(randomInRange(20, 90)),            // Hız (km/h)
        gsmspeed: String(randomInRange(20, 90, 1)),  // GPS/GSM tabanlı hız (km/h)
        x: String(position[0].toFixed(6)),            // Enlem (lat)
        y: String(position[1].toFixed(6)),             // Boylam (lng)
        gs: String(randomInRange(0, 33)),              // GSM sinyal kalitesi (0-32)

        fv: String(randomInRange(30, 50, 1)),          // Yakıt hücresi voltaj (V)
        fa: String(randomInRange(5, 25, 1)),           // Yakıt hücresi akım (A)
        fw: String(randomInRange(200, 800)),           // Yakıt hücresi watt (W)
        fet: String(randomInRange(25, 45)),            // Yakıt hücresi dış sıcaklık (°C)
        fit: String(randomInRange(50, 75)),            // Yakıt hücresi iç sıcaklık (°C)
        T_tank_C: String(simState.tank.toFixed(1)),    // Hidrojen tank sıcaklığı (°C)

        bv: String(randomInRange(40, 60, 1)),          // Batarya voltaj (V)
        bc: String(randomInRange(5, 40, 1)),           // Batarya akım (A)
        bw: String(randomInRange(500, 2000)),          // Batarya watt (W)
        bwh: String(simState.bwh.toFixed(1)),          // Batarya watt-saat (Wh)
        max_temperature: String(randomInRange(30, 50)), // Batarya paketi maksimum sıcaklığı (°C)
        soc: String(Math.floor(simState.soc)),         // Şarj durumu (%)
        ke: String(simState.ke.toFixed(1)),            // Kalan enerji (kWh)
        ischarging: isCharging ? 'charging' : 'not_charging',
        charge_voltage: isCharging ? String(randomInRange(48, 55, 1)) : '0',
        charge_current: isCharging ? String(randomInRange(8, 18, 1)) : '0',
        charge_time: isCharging ? formatChargeTime(115 - ((phase - 30) * 5)) : '',

        mv: String(randomInRange(30, 60, 1)),          // Motor sürücü voltajı (V)
        mc: String(randomInRange(5, 50, 1)),           // Motor sürücü akımı (A)
        mw: String(randomInRange(300, 2500)),          // Motor sürücü gücü (W)
        enable: controllerEnabled ? '1' : '0',
        fwd_rev: String(driveDirection),
        rpm: String(randomInRange(800, 4200)),
        throttle: String(randomInRange(0, 101)),
        controller_temperature: String(randomInRange(30, 75)),
        controller_speed: String(randomInRange(20, 90, 1)),
        error_code: String(activeErrorTest.code),
        errorcode1: String(vehicleControlErrorCodes[0] || 0),
        errorcode2: String(vehicleControlErrorCodes[1] || 0),
        errorcode3: String(vehicleControlErrorCodes[2] || 0)
    };

    const missingFields = config.URBAN_DATA_FIELDS.filter(field => telemetryData[field] === undefined);
    if (missingFields.length > 0) {
        throw new Error(`Eksik URBAN alanları: ${missingFields.join(', ')}`);
    }

    // config.URBAN_DATA_FIELDS sırasına göre 35 alanlı yıldız ayrımlı string oluştur
    const message = '01_' + config.URBAN_DATA_FIELDS.map(f => telemetryData[f]).join('*');

    client.publish(TOPIC, message, { qos: 1 }, (error) => {
        if (error) {
            console.error('❌ Veri gönderme hatası:', error);
        } else {
            const chargeInfo = isCharging ? ` | 🔋 Şarj=${telemetryData.charge_time}` : '';
            const errorInfo = activeErrorTest.code === 0
                ? ' | ✅ Hata=0 (Hata yok)'
                : ` | ⚠️ Hata=${activeErrorTest.code} (${activeErrorTest.label})`;
            const vehicleControlErrorInfo = activeErrorTest.vehicleControlErrorCodes
                ? ` | AKS=${activeErrorTest.vehicleControlErrorCodes.join('/')}`
                : '';
            console.log(
                `📤 Hız=${telemetryData.h}km/h | GSM=${telemetryData.gs} | SOC=${telemetryData.soc}%`
                + ` | Kelly=${controllerEnabled ? 'Açık' : 'Kapalı'}/${driveDirection}`
                + `${chargeInfo}${errorInfo}${vehicleControlErrorInfo}`
            );
        }
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 URBAN publisher kapatılıyor...');
    client.end(false, () => {
        console.log('✅ MQTT bağlantısı kapatıldı');
        process.exit(0);
    });
});
