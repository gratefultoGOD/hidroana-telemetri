// MQTT Publisher - Vehicle Telemetry Data Generator
const mqtt = require('mqtt');

// HiveMQ Cloud broker settings
/*
const BROKER_URL = 'mqtt://45.94.4.153:1883';
const BROKER_OPTIONS = {
    username: 'hidroana',
    password: 'hidro2626',
    //protocol: 'mqtts',
    port: 1883
};
*/

const BROKER_URL = 'mqtts://7b53477c154b4e65a96dbaa8ca717dfc.s1.eu.hivemq.cloud';
const BROKER_OPTIONS = {
    username: 'admin',
    password: 'Admin123',
};

const TOPIC = 'data';
const TAKE_TOPIC = 'take';

// Route coordinates
const route = [
    [41.7128, -74.0060], [41.7138, -74.0050], [41.7148, -74.0040],
    [41.7158, -74.0030], [41.7168, -74.0020], [41.7178, -74.0010],
    [41.7188, -74.0000], [41.7198, -73.9990], [41.7208, -73.9980],
    [41.7218, -73.9970], [41.7228, -73.9960], [41.7238, -73.9950],
    [41.7248, -73.9940], [41.7258, -73.9930], [41.7268, -73.9920],
    [41.7278, -73.9910], [41.7288, -73.9900], [41.7298, -73.9890],
    [41.7308, -73.9880], [41.7318, -73.9870]
];

let routeIndex = 0;
let direction = 1;

// Simulated values with realistic variations
let simState = {
    soc: 85,
    ke: 45,
    bwh: 100,
    jwh: 50
};

console.log('🔌 HiveMQ Cloud broker\'a bağlanılıyor...');
const client = mqtt.connect(BROKER_URL, BROKER_OPTIONS);

client.on('connect', () => {
    client.subscribe(TOPIC, { qos: 1 });
    client.subscribe(TAKE_TOPIC, { qos: 1 });
    console.log('✅ MQTT broker\'a bağlandı!');
    console.log(`📡 Topic: ${TOPIC}`);
    console.log('🚀 Veri gönderimi başlıyor...\n');
    console.log('📊 Veri formatı: h, x, y, gs, fv, fa, fw, fet, fit, bv, bc, bw, bwh, t1, t2, t3, soc, ke, jv, jc, jw, jwh\n');

    sendTelemetryData();
    //setInterval(sendTelemetryData, 250);

});

client.on('message', (topic, message) => {
    if (topic == TAKE_TOPIC) {
        console.log('Supercapacitor: ', message.toString());
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
    const oldPosition = route[routeIndex];

    if (routeIndex >= route.length - 1) direction = -1;
    else if (routeIndex <= 0) direction = 1;
    routeIndex += direction;

    const newPosition = route[routeIndex];

    // Update simulated state
    simState.soc = varyValue(simState.soc, 2, 10, 100);
    simState.ke = varyValue(simState.ke, 1, 5, 60);
    simState.bwh += randomInRange(0.1, 0.5, 1);
    simState.jwh += randomInRange(0.05, 0.2, 2);

    // Generate telemetry data in new format
    const telemetryData = {
        // Speed and Position
        h: String(randomInRange(20, 90)),           // Current speed (km/h)
        x: String(newPosition[1].toFixed(6)),       // Longitude
        y: String(newPosition[0].toFixed(6)),       // Latitude
        gs: String(randomInRange(60, 100)),         // GSM signal quality (%)

        // Fuel Cell
        fv: String(randomInRange(30, 50, 1)),       // Fuel cell voltage (V)
        fa: String(randomInRange(5, 25, 1)),        // Fuel cell current (A)
        fw: String(randomInRange(200, 800)),        // Fuel cell watt (W)
        fet: String(randomInRange(25, 45)),         // Fuel cell external temp (°C)
        fit: String(randomInRange(50, 75)),         // Fuel cell internal temp (°C)

        // Battery
        bv: String(randomInRange(280, 350, 1)),     // Battery voltage (V)
        bc: String(randomInRange(10, 40, 1)),       // Battery current (A)
        bw: String(randomInRange(1000, 4000)),      // Battery watt (W)
        bwh: String(simState.bwh.toFixed(1)),       // Battery watt-hour (Wh)
        t1: String(randomInRange(25, 45)),          // Battery temp 1 (°C)
        t2: String(randomInRange(28, 48)),          // Battery temp 2 (°C)
        t3: String(randomInRange(30, 50)),          // Battery temp 3 (°C)
        soc: String(Math.floor(simState.soc)),      // State of charge (%)
        ke: String(simState.ke.toFixed(1)),         // Remaining energy (kWh)

        // Joulemeter
        jv: String(randomInRange(60, 90, 1)),       // Joulemeter voltage (V)
        jc: String(randomInRange(20, 60, 1)),       // Joulemeter current (A)
        jw: String(randomInRange(500, 2000)),       // Joulemeter watt (W)
        jwh: String(simState.jwh.toFixed(1))        // Joulemeter watt-hour (Wh)
    };

    //    const message = JSON.stringify(telemetryData);
    let message = "01_";

    for (let key in telemetryData) {
        message += telemetryData[key] + "*"
    }

    message = message.slice(0, -1);


    client.publish(TOPIC, message, { qos: 1 }, (error) => {
        if (error) {
            console.error('❌ Veri gönderme hatası:', error);
        } else {
            //client.publish(TOPIC, 'take', { qos: 1 });
            //console.log(`📤 Hız=${telemetryData.h}km/h | SOC=${telemetryData.soc}% | Batarya=${telemetryData.bw}W | Yakıt=${telemetryData.fw}W | Joule=${telemetryData.jw}W`);
            //console.log(message);
        }
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Publisher kapatılıyor...');
    client.end(false, () => {
        console.log('✅ MQTT bağlantısı kapatıldı');
        process.exit(0);
    });
});
