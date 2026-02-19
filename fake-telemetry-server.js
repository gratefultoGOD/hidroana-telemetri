/**
 * Fake Telemetry Client - Silesia Ring Track Simulator
 * Araç gibi davranarak ana sunucuya GET isteği ile telemetri verisi gönderir
 * Pistin gerçek koordinatlarını kullanarak simülasyon yapar
 */

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000/data';
const SEND_INTERVAL = parseInt(process.env.SEND_INTERVAL) || 1000; // ms

// Silesia Ring pist koordinatları (ana noktalar - daha hızlı simülasyon için)
const trackCoordinates = [
    [50.52921, 18.09611],   // Start
    [50.52915, 18.09623],   // Düz 1
    [50.52905, 18.09665],   // Düz 2
    [50.52880, 18.09710],   // Viraj 1 giriş
    [50.52866, 18.09733],   // Viraj 1
    [50.52850, 18.09745],   // Viraj 1 çıkış
    [50.52830, 18.09750],   // Düz 3
    [50.52810, 18.09710],   // Viraj 2 giriş
    [50.52803, 18.09665],   // Viraj 2
    [50.52802, 18.09610],   // Viraj 2 çıkış
    [50.52823, 18.09560],   // Düz 4
    [50.52828, 18.09510],   // Düz 5
    [50.52835, 18.09450],   // Düz 6
    [50.52838, 18.09390],   // Viraj 3 giriş
    [50.52839, 18.09330],   // Viraj 3
    [50.52838, 18.09270],   // Viraj 3 çıkış
    [50.52868, 18.09365],   // Viraj 4 giriş
    [50.52867, 18.09310],   // Viraj 4
    [50.52868, 18.09260],   // Viraj 4 çıkış
    [50.52862, 18.09210],   // Düz 7
    [50.52860, 18.09150],   // Düz 8
    [50.52860, 18.09090],   // Viraj 5 giriş
    [50.52862, 18.09070],   // Viraj 5
    [50.52870, 18.09045],   // Viraj 5 çıkış
    [50.52900, 18.09035],   // Düz 9
    [50.52950, 18.09035],   // Düz 10
    [50.53000, 18.09110],   // Viraj 6 giriş
    [50.53050, 18.09180],   // Viraj 6
    [50.53100, 18.09250],   // Viraj 6 çıkış
    [50.53150, 18.09320],   // Düz 11
    [50.53200, 18.09390],   // Düz 12
    [50.53250, 18.09460],   // Düz 13
    [50.53300, 18.09530],   // Viraj 7 giriş
    [50.53350, 18.09560],   // Viraj 7
    [50.53400, 18.09560],   // Viraj 7 çıkış
    [50.53450, 18.09530],   // Düz 14
    [50.53500, 18.09460],   // Düz 15
    [50.53550, 18.09390],   // Viraj 8 giriş
    [50.53560, 18.09320],   // Viraj 8
    [50.53540, 18.09250],   // Viraj 8 çıkış
    [50.53500, 18.09180],   // Düz 16
    [50.53450, 18.09110],   // Düz 17
    [50.53400, 18.09040],   // Viraj 9 giriş
    [50.53350, 18.09000],   // Viraj 9
    [50.53300, 18.09000],   // Viraj 9 çıkış
    [50.53250, 18.09040],   // Düz 18
    [50.53200, 18.09110],   // Düz 19
    [50.53150, 18.09180],   // Viraj 10 giriş
    [50.53100, 18.09220],   // Viraj 10
    [50.53050, 18.09220],   // Viraj 10 çıkış
    [50.53000, 18.09180],   // Düz 20
    [50.52950, 18.09110],   // Düz 21
    [50.52920, 18.09610]    // Finish (Start'a dön)
];

let currentTrackIndex = 0;
let trackProgress = 0; // 0-1 arası, iki nokta arasındaki ilerleme

// Başlangıç değerleri
let state = {
    h: 25,          // Hız (km/h)
    x: trackCoordinates[0][0],  // Latitude (Enlem - cihaz x olarak latitude gönderiyor)
    y: trackCoordinates[0][1],  // Longitude (Boylam - cihaz y olarak longitude gönderiyor)
    gp: 1,          // GPS fix
    gs: 20,         // GSM sinyal
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

// İki nokta arasında interpolasyon
function lerp(start, end, t) {
    return start + (end - start) * t;
}

// Veriyi güncelle (gerçekçi değişimler + pist takibi)
function updateState() {
    // Hız değişimi (20-60 km/h arası)
    state.h = vary(state.h, 5, 20, 60);
    
    // Pist üzerinde ilerleme (çok hızlı)
    const speedFactor = state.h / 30; // Hıza göre ilerleme hızı
    trackProgress += 0.4 * speedFactor; // Çok hızlı ilerleme
    
    if (trackProgress >= 1) {
        trackProgress = 0;
        currentTrackIndex = (currentTrackIndex + 1) % trackCoordinates.length;
    }
    
    // Mevcut ve sonraki nokta
    const currentPoint = trackCoordinates[currentTrackIndex];
    const nextPoint = trackCoordinates[(currentTrackIndex + 1) % trackCoordinates.length];
    
    // Koordinatları interpolate et
    state.x = lerp(currentPoint[0], nextPoint[0], trackProgress);
    state.y = lerp(currentPoint[1], nextPoint[1], trackProgress);
    
    // Diğer sensör verileri
    state.gp = 1; // GPS fix her zaman 1
    state.gs = Math.round(vary(state.gs, 2, 15, 30));
    state.fv = vary(state.fv, 0.5, 40, 50);
    state.fa = vary(state.fa, 0.3, 10, 20);
    state.fw = state.fv * state.fa;
    state.fet = vary(state.fet, 1, 40, 60);
    state.fit = vary(state.fit, 1, 45, 65);
    state.bv = vary(state.bv, 0.3, 45, 52);
    state.bc = vary(state.bc, 0.5, 10, 25);
    state.bw = state.bv * state.bc;
    state.bwh = vary(state.bwh, 2, 100, 200);
    state.t1 = vary(state.t1, 0.5, 28, 38);
    state.t2 = vary(state.t2, 0.5, 28, 38);
    state.t3 = vary(state.t3, 0.5, 28, 38);
    state.soc = vary(state.soc, 0.2, 60, 95);
    state.ke = vary(state.ke, 0.05, 1.5, 3.5);
    state.jv = vary(state.jv, 0.3, 45, 52);
    state.jc = vary(state.jc, 0.5, 10, 20);
    state.jw = state.jv * state.jc;
    state.jwh = vary(state.jwh, 5, 1000, 1500);
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
        //id: state.id,
        key: '066c4e702e'
    });
    return params.toString();
}

// Sunucuya veri gönder (GET isteği)
async function sendData() {
    updateState();
    const queryString = buildQueryString();
    const url = `${TARGET_URL}?${queryString}`;
    //console.log(url);
    try {
        const response = await fetch(url);
        const text = await response.text();

        if (response.ok) {
            console.log(text);
        } else {
            console.log(`⚠️  Sunucu yanıtı: ${text}`);
        }
    } catch (error) {
        console.error(`❌ Bağlantı hatası: ${error.message}`);
    }
}

console.log(`\n🚗 Fake Telemetry Client - Silesia Ring Simulator`);
console.log(`📡 Hedef: ${TARGET_URL}`);
console.log(`⏱️  Gönderim aralığı: ${SEND_INTERVAL}ms`);
console.log(`🏁 Pist: Silesia Ring (${trackCoordinates.length} nokta)`);
console.log(`📋 Format: GET ?h=&x=&y=&gp=&gs=&fv=&fa=&fw=&...`);
console.log(`\n⚠️  Ana sunucunun HTTP modunda olduğundan emin olun!\n`);

// Periyodik gönderim
setInterval(sendData, SEND_INTERVAL);
sendData();