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
    jwh: 50,
    tank: 30   // Hidrojen tank sıcaklığı (°C) — yumuşak değişim için
};

console.log('🔌 URBAN publisher — MQTT broker\'a bağlanılıyor...');
const client = mqtt.connect(config.MQTT_BROKER_URL, config.MQTT_OPTIONS);

client.on('connect', () => {
    client.subscribe(TAKE_TOPIC, { qos: 1 });
    console.log('✅ MQTT broker\'a bağlandı!');
    console.log(`📡 Topic: ${TOPIC} (URBAN formatında)`);
    console.log(`📊 Veri formatı: ${config.URBAN_DATA_FIELDS.join(', ')}`);
    console.log(`⏱️  Gönderim aralığı: ${SEND_INTERVAL_MS}ms`);
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
    let newValue = base + (Math.random() - 0.5) * variance;
    return Math.max(min, Math.min(max, newValue));
}

function sendTelemetryData() {
    // Move along route
    if (routeIndex >= route.length - 1) direction = -1;
    else if (routeIndex <= 0) direction = 1;
    routeIndex += direction;

    const position = route[routeIndex];

    // Update simulated state
    simState.soc = varyValue(simState.soc, 2, 10, 100);
    simState.ke = varyValue(simState.ke, 1, 5, 60);
    simState.bwh += randomInRange(0.1, 0.5, 1);
    simState.jwh += randomInRange(0.05, 0.2, 2);
    simState.tank = varyValue(simState.tank, 1.5, 15, 55);

    // config.js convention: raw 'x' alanı enlem (lat), raw 'y' alanı boylam (lng)
    const telemetryData = {
        h: String(randomInRange(20, 90)),            // Hız (km/h)
        x: String(position[0].toFixed(6)),            // Enlem (lat)
        y: String(position[1].toFixed(6)),             // Boylam (lng)
        gs: String(randomInRange(60, 100)),            // GSM sinyal kalitesi (%)

        fv: String(randomInRange(30, 50, 1)),          // Yakıt hücresi voltaj (V)
        fa: String(randomInRange(5, 25, 1)),           // Yakıt hücresi akım (A)
        fw: String(randomInRange(200, 800)),           // Yakıt hücresi watt (W)
        fet: String(randomInRange(25, 45)),            // Yakıt hücresi dış sıcaklık (°C)
        fit: String(randomInRange(50, 75)),            // Yakıt hücresi iç sıcaklık (°C)

        bv: String(randomInRange(40, 60, 1)),          // Batarya voltaj (V)
        bc: String(randomInRange(5, 40, 1)),           // Batarya akım (A)
        bw: String(randomInRange(500, 2000)),          // Batarya watt (W)
        bwh: String(simState.bwh.toFixed(1)),          // Batarya watt-saat (Wh)
        t1: String(randomInRange(25, 45)),             // Batarya sıcaklık 1 (°C)
        t2: String(randomInRange(28, 48)),             // Batarya sıcaklık 2 (°C)
        t3: String(randomInRange(30, 50)),             // Batarya sıcaklık 3 (°C)
        soc: String(Math.floor(simState.soc)),         // Şarj durumu (%)
        ke: String(simState.ke.toFixed(1)),            // Kalan enerji (kWh)

        jv: String(randomInRange(30, 60, 1)),          // Motor (joulemetre kanalı) voltaj (V)
        jc: String(randomInRange(5, 50, 1)),           // Motor (joulemetre kanalı) akım (A)
        jw: String(randomInRange(300, 2500)),          // Motor (joulemetre kanalı) watt (W)
        jwh: String(simState.jwh.toFixed(1)),          // Motor (joulemetre kanalı) watt-saat (Wh)

        gsmspeed: String(randomInRange(20, 90)),       // GSM tabanlı hız (km/h)
        T_tank_C: String(simState.tank.toFixed(1))     // Hidrojen tank sıcaklığı (°C)
    };

    // config.URBAN_DATA_FIELDS sırasına göre yıldız ile ayrılmış string oluştur
    const message = '01_' + config.URBAN_DATA_FIELDS.map(f => telemetryData[f]).join('*');

    client.publish(TOPIC, message, { qos: 1 }, (error) => {
        if (error) {
            console.error('❌ Veri gönderme hatası:', error);
        } else {
            console.log(`📤 Hız=${telemetryData.h}km/h | SOC=${telemetryData.soc}% | Batarya=${telemetryData.bw}W | Yakıt=${telemetryData.fw}W | Motor=${telemetryData.jw}W | Tank=${telemetryData.T_tank_C}°C`);
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
