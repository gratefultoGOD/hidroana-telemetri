// ============================================
// LAP/RACE YÖNETİMİ (In-Memory State)
// Yarış başlat/durdur/sıfırla, tur kaydı ve dosyaya kaydetme
// ============================================
const fs = require('fs');
const path = require('path');

const config = require('../config');
const state = require('../state');
const { timestampedFileName } = require('../utils/helpers');
const { broadcastLapState } = require('./sse');
const { getActiveVehicle } = require('./systemSettings');

const { RACES_DIR } = config;

// Yarış durdurulurken devam eden son turun sayılması için gereken en az süre.
// Böylece "LAP + hemen STOP" durumunda sıfıra yakın sahte tur oluşmaz.
const MIN_FINAL_LAP_MS = 1000;

let lapState = {
    active: false,
    startTime: null,
    startJwh: null,
    laps: [],
    currentJwh: 0,
    savedFileName: null   // Stop sırasında kaydedildi mi?
};

// SSE payload'ı oluştur (stream'in ilk bağlantısında da kullanılır)
function getLapStatePayload() {
    return {
        type: 'lap_update',
        active: lapState.active,
        startTime: lapState.startTime,
        startJwh: lapState.startJwh,
        laps: lapState.laps,
        currentJwh: lapState.currentJwh,
        serverTime: Date.now()
    };
}

// Lap durumunu tüm SSE client'larına yayınla
function publishLapState() {
    broadcastLapState(getLapStatePayload());
}

// Mevcut Jwh değerini son telemetriden oku.
// Aktif araç URBAN ise URBAN telemetrisinden, değilse ana (PROTO) telemetriden okunur.
function getCurrentJwh() {
    const latest = getActiveVehicle() === 'urban'
        ? state.latestUrbanTelemetryData
        : state.latestTelemetryData;
    return latest ? (parseFloat(latest.jwh) || 0) : 0;
}

// Yarışı başlat
function startRace() {
    const now = Date.now();
    const currentJwh = getCurrentJwh();

    lapState = {
        active: true,
        startTime: now,
        startJwh: currentJwh,
        laps: [],
        currentJwh: currentJwh,
        savedFileName: null
    };

    console.log(`🏁 Yarış başlatıldı! Başlangıç Jwh: ${currentJwh}`);
    publishLapState();
    return { startTime: now, startJwh: currentJwh };
}

// Tur kaydet
function recordLap() {
    const now = Date.now();
    const currentJwh = getCurrentJwh();
    const lapNum = lapState.laps.length + 1;

    const prevLap = lapState.laps[lapState.laps.length - 1];
    const lapStartTime = prevLap ? prevLap.endTime : lapState.startTime;
    const lapStartJwh = prevLap ? prevLap.endJwh : lapState.startJwh;

    const lap = {
        lapNum: lapNum,
        startTime: lapStartTime,
        endTime: now,
        lapDuration: now - lapStartTime,
        startJwh: lapStartJwh,
        endJwh: currentJwh,
        lapJwh: currentJwh - lapStartJwh
    };

    lapState.laps.push(lap);
    lapState.currentJwh = currentJwh;

    console.log(`🏁 Tur ${lapNum} kaydedildi! Süre: ${lap.lapDuration}ms, Wh: ${lap.lapJwh.toFixed(3)}`);
    publishLapState();
    return lap;
}

// Yarışı durdur — devam eden son turu kaydeder, sonra (tur varsa) dosyaya yazar
function stopRace() {
    // Durdurma anında devam eden turu otomatik kaydet: kullanıcı ayrıca LAP'a
    // basmak zorunda kalmadan son tur da sayılır. Son sınırın üzerinden yeterli
    // süre geçtiyse kaydedilir (LAP'ın hemen ardından STOP'ta sahte tur olmaz).
    if (lapState.active && lapState.startTime) {
        const prevLap = lapState.laps[lapState.laps.length - 1];
        const lapStartTime = prevLap ? prevLap.endTime : lapState.startTime;
        if (Date.now() - lapStartTime >= MIN_FINAL_LAP_MS) {
            recordLap();
        }
    }

    lapState.active = false;

    let savedFile = null;
    if (lapState.laps.length > 0 && !lapState.savedFileName) {
        savedFile = saveRaceToFile();
        lapState.savedFileName = savedFile;
    }

    console.log(`🏁 Yarış durduruldu! Toplam ${lapState.laps.length} tur${savedFile ? ` | Kaydedildi: ${savedFile}` : ''}`);
    publishLapState();
    return { lapCount: lapState.laps.length, savedFile };
}

// Yarışı sıfırla — stop sırasında kaydedilmediyse şimdi kaydeder
function resetRace() {
    let savedFile = lapState.savedFileName || null;
    if (lapState.laps.length > 0 && !lapState.savedFileName) {
        savedFile = saveRaceToFile();
    }

    lapState = {
        active: false,
        startTime: null,
        startJwh: null,
        laps: [],
        currentJwh: 0,
        savedFileName: null
    };

    console.log(`🏁 Yarış sıfırlandı!${savedFile ? ` Kaydedilen dosya: ${savedFile}` : ''}`);
    publishLapState();
    return savedFile;
}

// Yarış verisini dosyaya kaydet (reset veya stop sırasında)
function saveRaceToFile() {
    if (lapState.laps.length === 0) return null;

    const now = new Date();
    const fileName = timestampedFileName('race', now);
    const filePath = path.join(RACES_DIR, fileName);

    // CSV oluştur
    let csv = '\uFEFF'; // BOM
    csv += 'Tur No;Başlangıç (ms);Tur Süresi (ms);Tur Wh;Toplam Wh\n';

    lapState.laps.forEach(lap => {
        const startMs = lap.startTime - lapState.startTime;
        csv += [
            lap.lapNum,
            startMs,
            lap.lapDuration,
            lap.lapJwh.toFixed(3),
            lap.endJwh.toFixed(3)
        ].join(';') + '\n';
    });

    const lastLap = lapState.laps[lapState.laps.length - 1];
    const totalDuration = lastLap.endTime - lapState.startTime;
    const totalJwh = lastLap.endJwh - lapState.startJwh;

    // Metadata JSON olarak ayrı dosyaya kaydet
    const metaPath = filePath.replace('.csv', '.json');
    const meta = {
        fileName: fileName,
        savedAt: now.toISOString(),
        startTime: lapState.startTime,
        lapCount: lapState.laps.length,
        totalDuration: totalDuration,
        totalJwh: totalJwh,
        startJwh: lapState.startJwh
    };

    fs.writeFileSync(filePath, csv, 'utf8');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    console.log(`📁 Yarış kaydedildi: ${fileName} (${lapState.laps.length} tur)`);
    return fileName;
}

module.exports = {
    getLapState: () => lapState,
    getLapStatePayload,
    startRace,
    recordLap,
    stopRace,
    resetRace
};
