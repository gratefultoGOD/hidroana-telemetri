/**
 * Fake Telemetry Client
 * Araç gibi davranarak ana sunucuya GET isteği ile telemetri verisi gönderir
 * Ana sunucu HTTP modunda olmalı!
 */

//const TARGET_URL = process.env.TARGET_URL || 'http://78.135.85.247/api/vehicle/telemetry';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000/data';
const SEND_INTERVAL = parseInt(process.env.SEND_INTERVAL) || 1000; // ms

// Başlangıç değerleri
let state = {
    h: 25,          // Hız (km/h)
    x: 32.8597,     // Longitude (İstanbul)
    y: 39.9334,     // Latitude
    gp: 1,          // GPS fix
    gs: 85,         // GSM sinyal
    fv: 42.5,       // Fuel cell voltage
    fa: 12.3,       // Fuel cell current
    fw: 520,        // Fuel cell watt
    fet: 45,        // Fuel cell external temp
    fit: 52,        // Fuel cell internal temp
    kz: 10000,      // Sabit değer
    bv: 48.2,       // Battery voltage
    bc: 15.5,       // Battery current
    bw: 745,        // Battery watt
    bwh: 125,       // Battery watt-hour
    t1: 32,         // Temp 1
    t2: 34,         // Temp 2
    t3: 31,         // Temp 3
    soc: 78,        // State of charge
    ke: 2.4,        // Remaining energy (kWh)
    jv: 48.1,       // Joulemeter voltage
    jc: 14.2,       // Joulemeter current
    jw: 683,        // Joulemeter watt
    jwh: 1250,      // Joulemeter watt-hour
    id: 1           // Araç ID
};

// Rastgele değişim fonksiyonu
function vary(value, range, min = 0, max = Infinity) {
    const change = (Math.random() - 0.5) * range;
    return Math.max(min, Math.min(max, value + change));
}

// Veriyi güncelle (gerçekçi değişimler)
function updateState() {
    state.h = vary(state.h, 5, 0, 120);
    state.x = vary(state.x, 0.0001, 32.5, 33.0);
    state.y = vary(state.y, 0.0001, 39.7, 40.2);
    state.gp = Math.round(vary(state.gp, 0.5, 0, 3));
    state.gs = Math.round(vary(state.gs, 5, 50, 100));
    state.fv = vary(state.fv, 1, 35, 55);
    state.fa = vary(state.fa, 0.5, 5, 25);
    state.fw = state.fv * state.fa;
    state.fet = vary(state.fet, 2, 20, 70);
    state.fit = vary(state.fit, 2, 30, 80);
    state.bv = vary(state.bv, 0.5, 42, 54);
    state.bc = vary(state.bc, 1, 0, 50);
    state.bw = state.bv * state.bc;
    state.bwh = vary(state.bwh, 5, 0, 500);
    state.t1 = vary(state.t1, 1, 20, 50);
    state.t2 = vary(state.t2, 1, 20, 50);
    state.t3 = vary(state.t3, 1, 20, 50);
    state.soc = vary(state.soc, 0.5, 10, 100);
    state.ke = vary(state.ke, 0.1, 0, 5);
    state.jv = vary(state.jv, 0.5, 42, 54);
    state.jc = vary(state.jc, 1, 0, 40);
    state.jw = state.jv * state.jc;
    state.jwh = vary(state.jwh, 10, 0, 5000);
}

// Query string oluştur (araç formatı)
function buildQueryString() {
    const params = new URLSearchParams({
        h: Math.round(state.h),
        x: state.x.toFixed(6),
        y: state.y.toFixed(6),
        gp: state.gp,
        gs: state.gs,
        fv: state.fv.toFixed(2),
        fa: state.fa.toFixed(2),
        fw: state.fw.toFixed(2),
        fet: state.fet.toFixed(2),
        fit: state.fit.toFixed(2),
        kz: state.kz,
        bv: state.bv.toFixed(2),
        bc: state.bc.toFixed(2),
        bw: state.bw.toFixed(2),
        bwh: state.bwh.toFixed(2),
        t1: state.t1.toFixed(1),
        t2: state.t2.toFixed(1),
        t3: state.t3.toFixed(1),
        soc: state.soc.toFixed(2),
        ke: state.ke.toFixed(2),
        jv: state.jv.toFixed(2),
        jc: state.jc.toFixed(2),
        jw: state.jw.toFixed(2),
        jwh: state.jwh.toFixed(2),
        id: state.id,
        key: '066c4e702e'
    });
    return params.toString();
}

// Sunucuya veri gönder (GET isteği)
async function sendData() {
    updateState();
    const queryString = buildQueryString();
    const url = `${TARGET_URL}?${queryString}`;

    try {
        const response = await fetch(url);
        const text = await response.text();

        if (response.ok) {
            //console.log(`📤 Gönderildi: Hız=${Math.round(state.h)} km/h, SOC=${state.soc.toFixed(2)}%`);
            console.log(text);
        } else {
            console.log(`⚠️  Sunucu yanıtı: ${text}`);
        }
    } catch (error) {
        console.error(`❌ Bağlantı hatası: ${error.message}`);
    }
}

console.log(`\n🚗 Fake Telemetry Client Başlatıldı`);
console.log(`📡 Hedef: ${TARGET_URL}`);
console.log(`⏱️  Gönderim aralığı: ${SEND_INTERVAL}ms`);
console.log(`📋 Format: GET ?h=&x=&y=&gp=&gs=&fv=&fa=&fw=&...`);
console.log(`\n⚠️  Ana sunucunun HTTP modunda olduğundan emin olun!\n`);

// Periyodik gönderim
setInterval(sendData, SEND_INTERVAL);
sendData(); // İlk gönderim
