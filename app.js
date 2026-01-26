// Safe DOM element helper
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setElementStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

// Vehicle telemetry data fields
const dataFields = {
    h: 'speed',           // Current speed
    x: 'longitude',       // Longitude
    y: 'latitude',        // Latitude
    gs: 'gsmSignal',      // GSM signal quality
    fv: 'fuelVoltage',    // Fuel cell voltage
    fa: 'fuelCurrent',    // Fuel cell current
    fw: 'fuelWatt',       // Fuel cell watt
    fet: 'fuelExtTemp',   // Fuel cell external temperature
    fit: 'fuelIntTemp',   // Fuel cell internal temperature
    bv: 'batteryVoltage', // Battery voltage
    bc: 'batteryCurrent', // Battery current
    bw: 'batteryWatt',    // Battery watt
    bwh: 'batteryWh',     // Battery watt-hour
    t1: 'batteryTemp1',   // Battery temperature 1
    t2: 'batteryTemp2',   // Battery temperature 2
    t3: 'batteryTemp3',   // Battery temperature 3
    soc: 'stateOfCharge', // Battery state of charge
    ke: 'remainingEnergy',// Battery remaining energy
    jv: 'jouleVoltage',   // Joulemeter voltage
    jc: 'jouleCurrent',   // Joulemeter current
    jw: 'jouleWatt',      // Joulemeter watt
    jwh: 'jouleWh'        // Joulemeter watt-hour
};

// Map and marker
let map, marker;
let currentBearing = 0;

// Chart instances
let speedometerChart;
let fvChart, faChart, fwChart, ftempChart;
let socChart, keChart, bwChart, bwhChart, batteryVCChart, batteryTempChart;
let jvChart, jcChart, jwChart, jwhChart;

// History data for charts (last 10 seconds)
let history = {
    timestamp: [],
    speed: [],
    fv: [], fa: [], fw: [], fet: [], fit: [],
    bv: [], bc: [], bw: [], bwh: [],
    t1: [], t2: [], t3: [],
    soc: [], ke: [],
    jv: [], jc: [], jw: [], jwh: []
};

// All-time history for export
let allTimeHistory = {
    speed: [],
    fv: [], fa: [], fw: [], fet: [], fit: [],
    bv: [], bc: [], bw: [], bwh: [],
    t1: [], t2: [], t3: [],
    soc: [], ke: [],
    jv: [], jc: [], jw: [], jwh: []
};

// Connection status
let isConnected = false;
let lastDataTime = null;
let lastReceivedTimestamp = null;
let lastDataHash = null;
let lastDataCounter = null;

// Veri Kuyruğu Sistemi - Tab inaktifken gelen verileri saklamak için
let dataQueue = [];
const MAX_QUEUE_SIZE = 100; // Maksimum kuyruk boyutu

// Initialize map
function initMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl) {
        console.error('Map element not found');
        return;
    }

    map = L.map('map').setView([39.816297, 30.528611], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="transform: rotate(${currentBearing}deg); transition: transform 0.3s ease;">
                <svg width="40" height="40" viewBox="0 0 40 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                    <path d="M20 5 L30 30 L20 25 L10 30 Z" fill="#667eea" stroke="white" stroke-width="2"/>
                    <circle cx="20" cy="20" r="3" fill="white"/>
                </svg>
               </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    marker = L.marker([39.816111, 30.528611], { icon: customIcon }).addTo(map);
}

// Initialize speedometer
function initSpeedometer() {
    const canvas = document.getElementById('speedometer');
    if (!canvas) {
        console.error('Speedometer canvas not found');
        return;
    }
    const ctx = canvas.getContext('2d');

    speedometerChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, 180],
                backgroundColor: ['#667eea', '#e0e0e0'],
                borderWidth: 0,
                circumference: 180,
                rotation: 270
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '75%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}

// Chart configuration helper
function createLineChart(ctx, label, color, maxY = null) {
    const config = {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: color,
                backgroundColor: color + '20',
                tension: 0.4,
                fill: true,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true }
            }
        }
    };

    if (maxY) {
        config.options.scales.y.max = maxY;
    }

    return new Chart(ctx, config);
}

// Create multi-line chart
function createMultiLineChart(ctx, datasets) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: datasets.map(ds => ({
                label: ds.label,
                data: [],
                borderColor: ds.color,
                backgroundColor: ds.color + '20',
                tension: 0.4,
                fill: false,
                pointRadius: 2
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { boxWidth: 12, padding: 8, font: { size: 10 } }
                }
            },
            scales: { y: { beginAtZero: true } }
        }
    });
}

// Helper to safely get canvas context
function getCanvasContext(id) {
    const canvas = document.getElementById(id);
    if (!canvas) {
        console.error(`Canvas element not found: ${id}`);
        return null;
    }
    return canvas.getContext('2d');
}

// Initialize all charts
function initCharts() {
    // Fuel cell charts
    const fvCtx = getCanvasContext('fvChart');
    if (fvCtx) {
        fvChart = createLineChart(fvCtx, 'Voltaj (V)', '#f093fb');
    }

    const faCtx = getCanvasContext('faChart');
    if (faCtx) {
        faChart = createLineChart(faCtx, 'Akım (A)', '#4facfe');
    }

    const fwCtx = getCanvasContext('fwChart');
    if (fwCtx) {
        fwChart = createLineChart(fwCtx, 'Watt (W)', '#43e97b');
    }

    const ftempCtx = getCanvasContext('ftempChart');
    if (ftempCtx) {
        ftempChart = createMultiLineChart(ftempCtx, [
            { label: 'Dış Sıcaklık (°C)', color: '#ff6b6b' },
            { label: 'İç Sıcaklık (°C)', color: '#feca57' }
        ]);
    }

    // Battery charts - SOC, Remaining Energy, Power, Watt-Hour
    const socCtx = getCanvasContext('socChart');
    if (socCtx) {
        socChart = createLineChart(socCtx, 'SOC (%)', '#43e97b', 100);
    }

    const keCtx = getCanvasContext('keChart');
    if (keCtx) {
        keChart = createLineChart(keCtx, 'Kalan Enerji (kWh)', '#667eea');
    }

    const bwCtx = getCanvasContext('bwChart');
    if (bwCtx) {
        bwChart = createLineChart(bwCtx, 'Güç (W)', '#4facfe');
    }

    const bwhCtx = getCanvasContext('bwhChart');
    if (bwhCtx) {
        bwhChart = createLineChart(bwhCtx, 'Watt Saat (Wh)', '#fa709a');
    }

    const batteryVCCtx = getCanvasContext('batteryVCChart');
    if (batteryVCCtx) {
        batteryVCChart = createMultiLineChart(batteryVCCtx, [
            { label: 'Voltaj (V)', color: '#667eea' },
            { label: 'Akım (A)', color: '#43e97b' }
        ]);
    }

    const batteryTempCtx = getCanvasContext('batteryTempChart');
    if (batteryTempCtx) {
        batteryTempChart = createMultiLineChart(batteryTempCtx, [
            { label: 'T1 (°C)', color: '#ff6b6b' },
            { label: 'T2 (°C)', color: '#feca57' },
            { label: 'T3 (°C)', color: '#48dbfb' }
        ]);
    }

    // Joulemeter charts
    const jvCtx = getCanvasContext('jvChart');
    if (jvCtx) {
        jvChart = createLineChart(jvCtx, 'Voltaj (V)', '#f093fb');
    }

    const jcCtx = getCanvasContext('jcChart');
    if (jcCtx) {
        jcChart = createLineChart(jcCtx, 'Akım (A)', '#43e97b');
    }

    const jwCtx = getCanvasContext('jwChart');
    if (jwCtx) {
        jwChart = createLineChart(jwCtx, 'Watt (W)', '#4facfe');
    }

    const jwhCtx = getCanvasContext('jwhChart');
    if (jwhCtx) {
        jwhChart = createLineChart(jwhCtx, 'Watt Saat (Wh)', '#fa709a');
    }
}

// Fetch telemetry data from backend
async function fetchTelemetryData() {
    try {
        const response = await fetch('/api/telemetry');
        if (response.ok) {
            const data = await response.json();
            updateConnectionStatus(true);
            return data;
        } else {
            updateConnectionStatus(false);
            return null;
        }
    } catch (error) {
        console.error('Telemetri verisi fetch hatası:', error);
        updateConnectionStatus(false);
        return null;
    }
}

// Fetch ve kuyruğa ekleme fonksiyonu - arka planda çalışır
async function fetchAndQueueData() {
    const data = await fetchTelemetryData();

    if (!data) return;

    // Veri counter kontrolü - aynı veri duplikasyonunu önle
    if (data.dataCounter !== undefined) {
        if (lastDataCounter !== null && data.dataCounter === lastDataCounter) {
            return; // Aynı veri, ekleme
        }
        lastDataCounter = data.dataCounter;
    }

    // Veriyi kuyruğa ekle
    const queueItem = {
        data: data,
        timestamp: new Date()
    };

    dataQueue.push(queueItem);

    // Kuyruk boyutu kontrolü - eski verileri sil
    if (dataQueue.length > MAX_QUEUE_SIZE) {
        dataQueue.shift();
    }

    console.log(`📥 Veri kuyruğa eklendi. Kuyruk boyutu: ${dataQueue.length}`);
}

// Kuyruktaki verileri işle
function processDataQueue() {
    if (dataQueue.length === 0) {
        console.log('📭 Kuyruk boş, işlenecek veri yok');
        return;
    }

    console.log(`🔄 Kuyruk işleniyor. ${dataQueue.length} veri işlenecek...`);

    // Kuyruktaki tüm verileri işle
    while (dataQueue.length > 0) {
        const queueItem = dataQueue.shift();
        processQueuedData(queueItem.data, queueItem.timestamp);
    }

    console.log('✅ Kuyruk işleme tamamlandı');
}

// Kuyruktaki tek bir veriyi işle (updateVehicleData'nın kuyruk versiyonu)
function processQueuedData(data, queueTimestamp) {
    const time = queueTimestamp.toLocaleTimeString();
    const simTime = queueTimestamp;

    // Parse data - handle both direct format and nested format
    const telemetry = {
        h: parseFloat(data.h || data.speed || 0),
        x: parseFloat(data.x || data.longitude || 0),
        y: parseFloat(data.y || data.latitude || 0),
        gs: parseFloat(data.gs || data.gsmSignal || 0),
        fv: parseFloat(data.fv || data.fuelVoltage || 0),
        fa: parseFloat(data.fa || data.fuelCurrent || 0),
        fw: parseFloat(data.fw || data.fuelWatt || 0),
        fet: parseFloat(data.fet || data.fuelExtTemp || 0),
        fit: parseFloat(data.fit || data.fuelIntTemp || 0),
        bv: parseFloat(data.bv || data.batteryVoltage || 0),
        bc: parseFloat(data.bc || data.batteryCurrent || 0),
        bw: parseFloat(data.bw || data.batteryWatt || 0),
        bwh: parseFloat(data.bwh || data.batteryWh || 0),
        t1: parseFloat(data.t1 || data.batteryTemp1 || 0),
        t2: parseFloat(data.t2 || data.batteryTemp2 || 0),
        t3: parseFloat(data.t3 || data.batteryTemp3 || 0),
        soc: parseFloat(data.soc || data.stateOfCharge || 0),
        ke: parseFloat(data.ke || data.remainingEnergy || 0),
        jv: parseFloat(data.jv || data.jouleVoltage || 0),
        jc: parseFloat(data.jc || data.jouleCurrent || 0),
        jw: parseFloat(data.jw || data.jouleWatt || 0),
        jwh: parseFloat(data.jwh || data.jouleWh || 0)
    };

    // Store in history
    history.timestamp.push(simTime);
    history.speed.push(telemetry.h);
    history.fv.push(telemetry.fv);
    history.fa.push(telemetry.fa);
    history.fw.push(telemetry.fw);
    history.fet.push(telemetry.fet);
    history.fit.push(telemetry.fit);
    history.bv.push(telemetry.bv);
    history.bc.push(telemetry.bc);
    history.bw.push(telemetry.bw);
    history.bwh.push(telemetry.bwh);
    history.t1.push(telemetry.t1);
    history.t2.push(telemetry.t2);
    history.t3.push(telemetry.t3);
    history.soc.push(telemetry.soc);
    history.ke.push(telemetry.ke);
    history.jv.push(telemetry.jv);
    history.jc.push(telemetry.jc);
    history.jw.push(telemetry.jw);
    history.jwh.push(telemetry.jwh);

    // Store in all-time history
    Object.keys(allTimeHistory).forEach(key => {
        if (history[key]) {
            allTimeHistory[key].push(history[key][history[key].length - 1]);
        }
    });

    // Remove data older than 10 seconds
    const tenSecondsAgo = new Date(simTime.getTime() - 10000);
    while (history.timestamp.length > 0 && history.timestamp[0] < tenSecondsAgo) {
        history.timestamp.shift();
        Object.keys(history).forEach(key => {
            if (key !== 'timestamp' && history[key].length > 0) {
                history[key].shift();
            }
        });
    }

    // Update charts
    // Fuel cell charts
    updateChart(fvChart, time, telemetry.fv);
    updateChart(faChart, time, telemetry.fa);
    updateChart(fwChart, time, telemetry.fw);
    updateMultiChart(ftempChart, time, [telemetry.fet, telemetry.fit]);

    // Battery charts
    updateChart(socChart, time, telemetry.soc);
    updateChart(keChart, time, telemetry.ke);
    updateChart(bwChart, time, telemetry.bw);
    updateChart(bwhChart, time, telemetry.bwh);
    updateMultiChart(batteryVCChart, time, [telemetry.bv, telemetry.bc]);
    updateMultiChart(batteryTempChart, time, [telemetry.t1, telemetry.t2, telemetry.t3]);

    // Joulemeter charts
    updateChart(jvChart, time, telemetry.jv);
    updateChart(jcChart, time, telemetry.jc);
    updateChart(jwChart, time, telemetry.jw);
    updateChart(jwhChart, time, telemetry.jwh);
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    isConnected = connected;
    const statusEl = document.getElementById('mqttStatus');
    if (!statusEl) return;

    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span:last-child');
    if (!dot || !text) return;

    if (connected) {
        dot.style.background = '#43e97b';
        text.textContent = 'Bağlı';
        statusEl.classList.add('connected');
        statusEl.classList.remove('disconnected');
    } else {
        dot.style.background = '#ff4444';
        text.textContent = 'Bağlantı Yok';
        statusEl.classList.remove('connected');
        statusEl.classList.add('disconnected');
    }
}

// Update GSM signal indicator
function updateGSMSignal(value) {
    const gsmEl = document.getElementById('gsmSignal');
    const gsmValue = document.getElementById('gsmValue');
    if (!gsmEl || !gsmValue) return;

    const bars = gsmEl.querySelectorAll('.bar');
    const signal = parseInt(value) || 0;
    gsmValue.textContent = signal;

    // Update bar colors based on signal strength
    /*
    bars.forEach((bar, index) => {
        if (signal >= (index + 1) * 3.75) {
            bar.style.fill = '#43e97b';
        } else {
            bar.style.fill = '#e0e0e0';
        }
    });*/

    /*
        bars.forEach((bar, index) => {
            if (signal < 10) {
                bar.style.fill = ''
            }
    
        });
    */
    if (signal >= 20 && signal <= 30) {
        // 4 diş
        bars[0].style.fill = '#43e97b';
        bars[1].style.fill = '#43e97b';
        bars[2].style.fill = '#43e97b';
        bars[3].style.fill = '#43e97b';
    } else if (signal >= 15 && signal <= 19) {
        // 3 diş
        bars[0].style.fill = '#43e97b';
        bars[1].style.fill = '#43e97b';
        bars[2].style.fill = '#43e97b';
        bars[3].style.fill = '#e0e0e0';
    } else if (signal >= 10 && signal <= 14) {
        // 2 diş
        bars[0].style.fill = '#43e97b';
        bars[1].style.fill = '#43e97b';
        bars[2].style.fill = '#e0e0e0';
        bars[3].style.fill = '#e0e0e0';
    } else if (signal >= 1 && signal <= 9) {
        // 1 diş
        bars[0].style.fill = '#43e97b';
        bars[1].style.fill = '#e0e0e0';
        bars[2].style.fill = '#e0e0e0';
        bars[3].style.fill = '#e0e0e0';
    } else {
        // signal === 0 veya geçersiz değer
        bars[0].style.fill = '#e0e0e0';
        bars[1].style.fill = '#e0e0e0';
        bars[2].style.fill = '#e0e0e0';
        bars[3].style.fill = '#e0e0e0';
    }
}
// Calculate bearing between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
        Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

// Update single line chart
function updateChart(chart, time, value, maxPoints = 9) {
    if (!chart) return;
    if (chart.data.labels.length > maxPoints) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }
    chart.data.labels.push(time);
    chart.data.datasets[0].data.push(value);
    chart.update('none');
}

// Update multi-line chart
function updateMultiChart(chart, time, values, maxPoints = 9) {
    if (!chart) return;
    if (chart.data.labels.length > maxPoints) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.data.labels.push(time);
    values.forEach((val, i) => {
        chart.data.datasets[i].data.push(val);
    });
    chart.update('none');
}


// Main update function
async function updateVehicleData() {
    // Sayfa görünür değilse sadece veriyi kuyruğa ekle
    if (!isPageVisible) {
        await fetchAndQueueData();
        return;
    }

    // Önce kuyrukta bekleyen veriler varsa işle
    if (dataQueue.length > 0) {
        console.log(`📋 Önce kuyruktaki ${dataQueue.length} veri işleniyor...`);
        processDataQueue();
    }

    const data = await fetchTelemetryData();

    if (!data) {
        console.log('Veri bekleniyor...');
        return;
    }

    // Veri counter kontrolü - sadece yeni veri geldiğinde işle
    if (data.dataCounter !== undefined) {
        console.log(`📊 Veri counter: ${data.dataCounter}, Son: ${lastDataCounter}`);
        if (lastDataCounter !== null && data.dataCounter === lastDataCounter) {
            // Aynı veri counter'ı, yeni veri gelmemiş
            console.log('⏸️ Aynı veri, grafikler güncellenmedi');
            return;
        }
        // Yeni veri geldi, counter'ı güncelle
        lastDataCounter = data.dataCounter;
        console.log('✅ Yeni veri, grafikler güncelleniyor');
    }

    const time = new Date().toLocaleTimeString();
    const simTime = new Date();

    // Parse data - handle both direct format and nested format
    const telemetry = {
        h: parseFloat(data.h || data.speed || 0),
        x: parseFloat(data.x || data.longitude || 0),
        y: parseFloat(data.y || data.latitude || 0),
        gs: parseFloat(data.gs || data.gsmSignal || 0),
        fv: parseFloat(data.fv || data.fuelVoltage || 0),
        fa: parseFloat(data.fa || data.fuelCurrent || 0),
        fw: parseFloat(data.fw || data.fuelWatt || 0),
        fet: parseFloat(data.fet || data.fuelExtTemp || 0),
        fit: parseFloat(data.fit || data.fuelIntTemp || 0),
        bv: parseFloat(data.bv || data.batteryVoltage || 0),
        bc: parseFloat(data.bc || data.batteryCurrent || 0),
        bw: parseFloat(data.bw || data.batteryWatt || 0),
        bwh: parseFloat(data.bwh || data.batteryWh || 0),
        t1: parseFloat(data.t1 || data.batteryTemp1 || 0),
        t2: parseFloat(data.t2 || data.batteryTemp2 || 0),
        t3: parseFloat(data.t3 || data.batteryTemp3 || 0),
        soc: parseFloat(data.soc || data.stateOfCharge || 0),
        ke: parseFloat(data.ke || data.remainingEnergy || 0),
        jv: parseFloat(data.jv || data.jouleVoltage || 0),
        jc: parseFloat(data.jc || data.jouleCurrent || 0),
        jw: parseFloat(data.jw || data.jouleWatt || 0),
        jwh: parseFloat(data.jwh || data.jouleWh || 0)
    };

    // Update map position
    if (telemetry.x && telemetry.y) {
        const newPosition = [telemetry.y, telemetry.x]; // lat, lng

        // Calculate bearing if we have previous position
        const currentPos = marker.getLatLng();
        if (currentPos.lat !== newPosition[0] || currentPos.lng !== newPosition[1]) {
            currentBearing = calculateBearing(currentPos.lat, currentPos.lng, newPosition[0], newPosition[1]);
        }

        // Update marker
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="transform: rotate(${currentBearing}deg); transition: transform 0.3s ease;">
                    <svg width="40" height="40" viewBox="0 0 40 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                        <path d="M20 5 L30 30 L20 25 L10 30 Z" fill="#667eea" stroke="white" stroke-width="2"/>
                        <circle cx="20" cy="20" r="3" fill="white"/>
                    </svg>
                   </div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        marker.setIcon(customIcon);
        marker.setLatLng(newPosition);
        map.panTo(newPosition);

        setElementText('coordinate-label', `Koordinatlar: ${telemetry.y.toFixed(6)}, ${telemetry.x.toFixed(6)}`);
    }

    // Update GSM signal
    updateGSMSignal(telemetry.gs);

    // Update speedometer
    const speed = Math.min(telemetry.h, 60);
    if (speedometerChart) {
        speedometerChart.data.datasets[0].data = [speed, 60 - speed];
        speedometerChart.data.datasets[0].backgroundColor = [
            speed > 60 ? '#ff4444' : speed > 45 ? '#ffaa00' : '#667eea',
            '#e0e0e0'
        ];
        speedometerChart.update('none');
    }
    setElementText('speedValue', `${telemetry.h.toFixed(0)} km/h`);

    // Update stat cards
    setElementText('socValue', `${telemetry.soc.toFixed(0)}%`);
    setElementStyle('socFill', 'width', `${Math.min(telemetry.soc, 100)}%`);
    setElementStyle('socFill', 'background', telemetry.soc > 50 ? '#43e97b' : telemetry.soc > 20 ? '#feca57' : '#ff4444');

    setElementText('keValue', `${telemetry.ke.toFixed(1)} kWh`);
    setElementText('bwValue', `${telemetry.bw.toFixed(0)} W`);
    setElementText('bwhValue', `${telemetry.bwh.toFixed(1)} Wh`);
    setElementText('jwValue', `${telemetry.jw.toFixed(0)} W`);
    setElementText('jwhValue', `${telemetry.jwh.toFixed(1)} Wh`);

    // Store in history
    history.timestamp.push(simTime);
    history.speed.push(telemetry.h);
    history.fv.push(telemetry.fv);
    history.fa.push(telemetry.fa);
    history.fw.push(telemetry.fw);
    history.fet.push(telemetry.fet);
    history.fit.push(telemetry.fit);
    history.bv.push(telemetry.bv);
    history.bc.push(telemetry.bc);
    history.bw.push(telemetry.bw);
    history.bwh.push(telemetry.bwh);
    history.t1.push(telemetry.t1);
    history.t2.push(telemetry.t2);
    history.t3.push(telemetry.t3);
    history.soc.push(telemetry.soc);
    history.ke.push(telemetry.ke);
    history.jv.push(telemetry.jv);
    history.jc.push(telemetry.jc);
    history.jw.push(telemetry.jw);
    history.jwh.push(telemetry.jwh);

    // Store in all-time history
    Object.keys(allTimeHistory).forEach(key => {
        if (history[key]) {
            allTimeHistory[key].push(history[key][history[key].length - 1]);
        }
    });

    // Remove data older than 10 seconds
    const tenSecondsAgo = new Date(simTime.getTime() - 10000);
    while (history.timestamp.length > 0 && history.timestamp[0] < tenSecondsAgo) {
        history.timestamp.shift();
        Object.keys(history).forEach(key => {
            if (key !== 'timestamp' && history[key].length > 0) {
                history[key].shift();
            }
        });
    }

    // Calculate and display averages
    updateAverages();

    // Update charts
    // Fuel cell charts
    updateChart(fvChart, time, telemetry.fv);
    updateChart(faChart, time, telemetry.fa);
    updateChart(fwChart, time, telemetry.fw);
    updateMultiChart(ftempChart, time, [telemetry.fet, telemetry.fit]);

    // Battery charts
    updateChart(socChart, time, telemetry.soc);
    updateChart(keChart, time, telemetry.ke);
    updateChart(bwChart, time, telemetry.bw);
    updateChart(bwhChart, time, telemetry.bwh);
    updateMultiChart(batteryVCChart, time, [telemetry.bv, telemetry.bc]);
    updateMultiChart(batteryTempChart, time, [telemetry.t1, telemetry.t2, telemetry.t3]);

    // Joulemeter charts
    updateChart(jvChart, time, telemetry.jv);
    updateChart(jcChart, time, telemetry.jc);
    updateChart(jwChart, time, telemetry.jw);
    updateChart(jwhChart, time, telemetry.jwh);
}

// Calculate and update averages from server
async function updateAverages() {
    try {
        const res = await fetch('/api/telemetry/averages');
        if (!res.ok) return;
        const avg = await res.json();
        const a = avg.allTime;
        const r = avg.last15Seconds;

        // Fuel cell - format: (15s: X | Genel: Y)
        setElementText('fvAvg', `(15s: ${r.fv || '--'} | Genel: ${a.fv || '--'} V)`);
        setElementText('faAvg', `(15s: ${r.fa || '--'} | Genel: ${a.fa || '--'} A)`);
        setElementText('fwAvg', `(15s: ${r.fw || '--'} | Genel: ${a.fw || '--'} W)`);
        setElementText('ftempAvg', `(15s Dış: ${r.fet || '--'}°C İç: ${r.fit || '--'}°C | Genel Dış: ${a.fet || '--'}°C İç: ${a.fit || '--'}°C)`);

        // Battery
        setElementText('socAvg', `(15s: ${r.soc || '--'} | Genel: ${a.soc || '--'}%)`);
        setElementText('keAvg', `(15s: ${r.ke || '--'} | Genel: ${a.ke || '--'} kWh)`);
        setElementText('bwAvg', `(15s: ${r.bw || '--'} | Genel: ${a.bw || '--'} W)`);
        setElementText('bwhAvg', `(15s: ${r.bwh || '--'} | Genel: ${a.bwh || '--'} Wh)`);

        // Joulemeter
        setElementText('jvAvg', `(15s: ${r.jv || '--'} | Genel: ${a.jv || '--'} V)`);
        setElementText('jcAvg', `(15s: ${r.jc || '--'} | Genel: ${a.jc || '--'} A)`);
        setElementText('jwAvgLabel', `(15s: ${r.jw || '--'} | Genel: ${a.jw || '--'} W)`);
        setElementText('jwhAvg', `(15s: ${r.jwh || '--'} | Genel: ${a.jwh || '--'} Wh)`);
    } catch (e) {
        console.error('Ortalama verisi alınamadı:', e);
    }
}

// Toggle card collapse
function toggleCard(element) {
    const card = element.closest('.collapsible');
    const isCollapsing = !card.classList.contains('collapsed');

    if (isCollapsing) {
        card.dataset.expandedHeight = card.style.height || '';
        card.dataset.expandedMinHeight = card.style.minHeight || '';
        card.dataset.expandedFlex = card.style.flex || '';
        card.style.height = 'auto';
        card.style.minHeight = 'auto';
        card.style.flex = '0 0 auto';
    } else {
        card.style.height = card.dataset.expandedHeight || '';
        card.style.minHeight = card.dataset.expandedMinHeight || '';
        card.style.flex = card.dataset.expandedFlex || '';
    }

    card.classList.toggle('collapsed');
    element.textContent = card.classList.contains('collapsed') ? '+' : '−';

    // Resize charts after animation
    setTimeout(() => {
        if (!card.classList.contains('collapsed')) {
            resizeAllCharts();
        }
    }, 100);
}

// Resize all charts
function resizeAllCharts() {
    const charts = [speedometerChart, fvChart, faChart, fwChart, ftempChart,
        socChart, keChart, bwChart, bwhChart, batteryVCChart, batteryTempChart,
        jvChart, jcChart, jwChart, jwhChart];
    charts.forEach(chart => {
        if (chart) chart.resize();
    });
    if (map) map.invalidateSize();
}

// Toggle filter functionality - multiple categories can be active
function toggleFilter(category, button) {
    const speedCards = document.querySelectorAll('.speed-related');
    const fuelCards = document.querySelectorAll('.fuel-related');
    const batteryCards = document.querySelectorAll('.battery-related');
    const jouleCards = document.querySelectorAll('.joule-related');

    const categoryButtons = {
        speed: document.querySelector('[data-category="speed"]'),
        fuel: document.querySelector('[data-category="fuel"]'),
        battery: document.querySelector('[data-category="battery"]'),
        joule: document.querySelector('[data-category="joule"]')
    };

    const allButton = document.querySelector('[data-category="all"]');

    if (category === 'all') {
        // Tümü butonuna tıklandığında
        const isActive = button.classList.contains('active');

        if (isActive) {
            // Tümü aktifse, tüm kategorileri kapat
            button.classList.remove('active');
            Object.values(categoryButtons).forEach(btn => {
                if (btn) btn.classList.remove('active');
            });
            [speedCards, fuelCards, batteryCards, jouleCards].forEach(cards => {
                cards.forEach(card => card.style.display = 'none');
            });
        } else {
            // Tümü pasifse, tüm kategorileri aç
            button.classList.add('active');
            Object.values(categoryButtons).forEach(btn => {
                if (btn) btn.classList.add('active');
            });
            [speedCards, fuelCards, batteryCards, jouleCards].forEach(cards => {
                cards.forEach(card => card.style.display = '');
            });
        }
    } else {
        // Kategori butonuna tıklandığında toggle yap
        const isActive = button.classList.contains('active');

        const cardMap = {
            speed: speedCards,
            fuel: fuelCards,
            battery: batteryCards,
            joule: jouleCards
        };

        if (isActive) {
            // Kategoriyi kapat
            button.classList.remove('active');
            cardMap[category].forEach(card => card.style.display = 'none');
        } else {
            // Kategoriyi aç
            button.classList.add('active');
            cardMap[category].forEach(card => card.style.display = '');
        }

        // Tümü butonunun durumunu güncelle
        const allActive = Object.values(categoryButtons).every(btn => btn && btn.classList.contains('active'));
        const anyActive = Object.values(categoryButtons).some(btn => btn && btn.classList.contains('active'));

        if (allActive) {
            allButton.classList.add('active');
        } else {
            allButton.classList.remove('active');
        }
    }

    setTimeout(resizeAllCharts, 100);
}

// Eski filterView fonksiyonu için geriye dönük uyumluluk
function filterView(view, button) {
    toggleFilter(view, button);
}


// Drag and Drop functionality
let draggedElement = null;

function initDragAndDrop() {
    const allCards = document.querySelectorAll('.stat-card, .chart-container, .map-section');

    allCards.forEach(card => {
        const header = card.querySelector('.card-header') || card.querySelector('.drag-handle');

        if (header) {
            header.addEventListener('mousedown', function (e) {
                if (e.target.classList.contains('toggle-icon') || e.target.closest('.toggle-icon')) return;
                card.setAttribute('draggable', 'true');
            });

            header.addEventListener('mouseup', () => {
                setTimeout(() => card.removeAttribute('draggable'), 50);
            });

            header.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (!card.classList.contains('dragging')) {
                        card.removeAttribute('draggable');
                    }
                }, 50);
            });
        }

        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('dragover', handleDragOverElement);
    });

    const containers = ['.left-charts', '.center-section', '.right-charts'];
    containers.forEach(selector => {
        const container = document.querySelector(selector);
        if (container) {
            container.addEventListener('dragover', handleDragOver);
            container.addEventListener('drop', handleDrop);
            container.addEventListener('dragenter', handleDragEnter);
            container.addEventListener('dragleave', handleDragLeave);
        }
    });
}

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
    this.classList.remove('dragging');
    this.removeAttribute('draggable');
    document.querySelectorAll('.drag-over, .drag-over-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-item');
    });
}

function handleDragOverElement(e) {
    e.preventDefault();
    if (this === draggedElement) return;
    document.querySelectorAll('.drag-over-item').forEach(el => el.classList.remove('drag-over-item'));
    this.classList.add('drag-over-item');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter() {
    if (this !== draggedElement && !this.contains(draggedElement)) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    if (e.target === this) this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggedElement && (this.classList.contains('left-charts') ||
        this.classList.contains('center-section') ||
        this.classList.contains('right-charts'))) {

        const afterElement = getDragAfterElement(this, e.clientY);
        if (afterElement == null) {
            this.appendChild(draggedElement);
        } else {
            this.insertBefore(draggedElement, afterElement);
        }

        setTimeout(resizeAllCharts, 100);
    }
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.children].filter(child => {
        return (child.classList.contains('stat-card') ||
            child.classList.contains('chart-container') ||
            child.classList.contains('map-section') ||
            child.classList.contains('stats-row')) &&
            !child.classList.contains('dragging');
    });

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Card resize functionality
let resizeState = {
    isResizing: false,
    currentCard: null,
    startY: 0,
    startHeight: 0,
    minHeight: 150,
    maxHeight: 800
};

function initCardResize() {
    const allCards = document.querySelectorAll('.stat-card, .chart-container, .map-section');

    allCards.forEach(card => {
        const bottomHandle = document.createElement('div');
        bottomHandle.className = 'resize-handle resize-handle-bottom';
        card.appendChild(bottomHandle);
        bottomHandle.addEventListener('mousedown', (e) => startResize(e, card));
    });

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
}

function startResize(e, card) {
    e.preventDefault();
    e.stopPropagation();
    resizeState.isResizing = true;
    resizeState.currentCard = card;
    resizeState.startY = e.clientY;
    resizeState.startHeight = card.offsetHeight;
    card.classList.add('resizing');
    document.body.style.cursor = 'ns-resize';
}

function doResize(e) {
    if (!resizeState.isResizing || !resizeState.currentCard) return;

    const deltaY = e.clientY - resizeState.startY;
    let newHeight = Math.max(resizeState.minHeight, Math.min(resizeState.startHeight + deltaY, resizeState.maxHeight));

    resizeState.currentCard.style.height = newHeight + 'px';
    resizeState.currentCard.style.minHeight = newHeight + 'px';
    resizeState.currentCard.style.flex = '0 0 auto';

    requestAnimationFrame(resizeAllCharts);
}

function stopResize() {
    if (resizeState.isResizing && resizeState.currentCard) {
        resizeState.currentCard.classList.remove('resizing');
        document.body.style.cursor = '';
        // Resize bittikten sonra grafikleri yeniden boyutlandır
        setTimeout(resizeAllCharts, 50);
    }
    resizeState.isResizing = false;
    resizeState.currentCard = null;
}

// Column resize functionality
let columnResizeState = {
    isResizing: false,
    currentColumn: null,
    startX: 0,
    startWidth: 0,
    nextColumn: null,
    nextStartWidth: 0
};

function initColumnResize() {
    const mainContent = document.querySelector('.main-content');
    const leftCharts = document.querySelector('.left-charts');
    const centerSection = document.querySelector('.center-section');
    const rightCharts = document.querySelector('.right-charts');

    if (!leftCharts || !centerSection || !rightCharts) return;

    const leftHandle = document.createElement('div');
    leftHandle.className = 'column-resize-handle';
    leftHandle.innerHTML = '<div class="resize-indicator"></div>';
    mainContent.insertBefore(leftHandle, centerSection);

    const rightHandle = document.createElement('div');
    rightHandle.className = 'column-resize-handle';
    rightHandle.innerHTML = '<div class="resize-indicator"></div>';
    mainContent.insertBefore(rightHandle, rightCharts);

    leftHandle.addEventListener('mousedown', (e) => startColumnResize(e, leftCharts, centerSection));
    rightHandle.addEventListener('mousedown', (e) => startColumnResize(e, centerSection, rightCharts));

    document.addEventListener('mousemove', doColumnResize);
    document.addEventListener('mouseup', stopColumnResize);
}

function startColumnResize(e, currentCol, nextCol) {
    e.preventDefault();
    columnResizeState.isResizing = true;
    columnResizeState.currentColumn = currentCol;
    columnResizeState.nextColumn = nextCol;
    columnResizeState.startX = e.clientX;
    columnResizeState.startWidth = currentCol.offsetWidth;
    columnResizeState.nextStartWidth = nextCol.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
}

function doColumnResize(e) {
    if (!columnResizeState.isResizing) return;

    const deltaX = e.clientX - columnResizeState.startX;
    const newWidth = columnResizeState.startWidth + deltaX;
    const newNextWidth = columnResizeState.nextStartWidth - deltaX;

    if (newWidth >= 200 && newNextWidth >= 200) {
        columnResizeState.currentColumn.style.flex = `0 0 ${newWidth}px`;
        columnResizeState.nextColumn.style.flex = `0 0 ${newNextWidth}px`;
        requestAnimationFrame(resizeAllCharts);
    }
}

function stopColumnResize() {
    if (columnResizeState.isResizing) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    columnResizeState.isResizing = false;
    columnResizeState.currentColumn = null;
    columnResizeState.nextColumn = null;
}

// Export functions
function exportData(format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') exportCSV(timestamp);
    else if (format === 'json') exportJSON(timestamp);
}

function exportCSV(timestamp) {
    let csv = 'Zaman,Hız,Yakıt V,Yakıt A,Yakıt W,Yakıt Dış T,Yakıt İç T,Batarya V,Batarya A,Batarya W,Batarya Wh,T1,T2,T3,SOC,Kalan Enerji,Joule V,Joule A,Joule W,Joule Wh\n';

    const len = allTimeHistory.speed.length;
    for (let i = 0; i < len; i++) {
        const time = new Date(Date.now() - (len - i - 1) * 1500).toLocaleString('tr-TR');
        csv += `${time},${allTimeHistory.speed[i]},${allTimeHistory.fv[i]},${allTimeHistory.fa[i]},${allTimeHistory.fw[i]},${allTimeHistory.fet[i]},${allTimeHistory.fit[i]},${allTimeHistory.bv[i]},${allTimeHistory.bc[i]},${allTimeHistory.bw[i]},${allTimeHistory.bwh[i]},${allTimeHistory.t1[i]},${allTimeHistory.t2[i]},${allTimeHistory.t3[i]},${allTimeHistory.soc[i]},${allTimeHistory.ke[i]},${allTimeHistory.jv[i]},${allTimeHistory.jc[i]},${allTimeHistory.jw[i]},${allTimeHistory.jwh[i]}\n`;
    }

    downloadFile(csv, `hidroana-data-${timestamp}.csv`, 'text/csv');
}

function exportJSON(timestamp) {
    const len = allTimeHistory.speed.length;
    const jsonData = {
        exportDate: new Date().toISOString(),
        dataPoints: len,
        data: []
    };

    for (let i = 0; i < len; i++) {
        jsonData.data.push({
            timestamp: new Date(Date.now() - (len - i - 1) * 1500).toISOString(),
            speed: allTimeHistory.speed[i],
            fuelCell: {
                voltage: allTimeHistory.fv[i],
                current: allTimeHistory.fa[i],
                watt: allTimeHistory.fw[i],
                extTemp: allTimeHistory.fet[i],
                intTemp: allTimeHistory.fit[i]
            },
            battery: {
                voltage: allTimeHistory.bv[i],
                current: allTimeHistory.bc[i],
                watt: allTimeHistory.bw[i],
                wattHour: allTimeHistory.bwh[i],
                temp1: allTimeHistory.t1[i],
                temp2: allTimeHistory.t2[i],
                temp3: allTimeHistory.t3[i],
                soc: allTimeHistory.soc[i],
                remainingEnergy: allTimeHistory.ke[i]
            },
            joulemeter: {
                voltage: allTimeHistory.jv[i],
                current: allTimeHistory.jc[i],
                watt: allTimeHistory.jw[i],
                wattHour: allTimeHistory.jwh[i]
            }
        });
    }

    downloadFile(JSON.stringify(jsonData, null, 2), `hidroana-data-${timestamp}.json`, 'application/json');
}

function exportCharts() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const charts = [
        { chart: speedChart, name: 'hiz-grafigi' },
        { chart: speedometerChart, name: 'hiz-gostergesi' },
        { chart: fvChart, name: 'yakit-voltaj' },
        { chart: faChart, name: 'yakit-akim' },
        { chart: fwChart, name: 'yakit-watt' },
        { chart: ftempChart, name: 'yakit-sicaklik' },
        { chart: batteryVCChart, name: 'batarya-voltaj-akim' },
        { chart: batteryTempChart, name: 'batarya-sicaklik' },
        { chart: jvChart, name: 'joule-voltaj' },
        { chart: jcChart, name: 'joule-akim' },
        { chart: jwChart, name: 'joule-watt' },
        { chart: jwhChart, name: 'joule-watt-saat' }
    ];

    charts.forEach(({ chart, name }) => {
        if (chart) {
            const url = chart.toBase64Image();
            const link = document.createElement('a');
            link.download = `${name}-${timestamp}.png`;
            link.href = url;
            link.click();
        }
    });
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
let isPageVisible = !document.hidden;
let lastUpdateTime = 0;
let animationFrameId = null;


// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    initMap();
    initSpeedometer();
    initCharts();
    initDragAndDrop();
    initCardResize();
    initColumnResize();

    // Update every 100 milliseconds
    //setInterval(updateVehicleData, 100);
    startAnimationLoop();

    // Initial status
    updateConnectionStatus(false);
    setupVisibilityHandler();
});


function startAnimationLoop() {
    function animate(currentTime) {
        // Her 100ms'de bir güncelle
        if (currentTime - lastUpdateTime >= 100) {
            updateVehicleData();
            lastUpdateTime = currentTime;
        }

        // Döngüyü devam ettir
        animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
}

// Arka planda veri toplama için interval
let backgroundFetchInterval = null;

// Sayfa görünürlük kontrolü
function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', function () {
        const wasHidden = !isPageVisible;
        isPageVisible = !document.hidden;

        if (isPageVisible && wasHidden) {
            console.log('🟢 Sayfa aktif oldu');

            // Arka plan fetch'ini durdur
            if (backgroundFetchInterval) {
                clearInterval(backgroundFetchInterval);
                backgroundFetchInterval = null;
                console.log('⏹️ Arka plan veri toplama durduruldu');
            }

            // Kuyruktaki verileri işle - grafikleri SIFIRLAMADAN
            if (dataQueue.length > 0) {
                console.log(`📋 Kuyruktaki ${dataQueue.length} veri işleniyor...`);
                processDataQueue();
            }

            // Animation loop'u yeniden başlat
            if (!animationFrameId) {
                lastUpdateTime = 0;
                startAnimationLoop();
            }
        } else if (!isPageVisible) {
            console.log('🔴 Sayfa arka planda');

            // Arka planda veri toplamaya devam et (her 100ms'de bir)
            if (!backgroundFetchInterval) {
                backgroundFetchInterval = setInterval(fetchAndQueueData, 100);
                console.log('▶️ Arka plan veri toplama başladı');
            }
        }
    });
}

// Tüm Chart.js grafiklerini sıfırla (artık sadece gerektiğinde çağrılır)
function resetAllCharts() {
    const chartInstances = [
        'speedometerChart',
        'fvChart',
        'faChart',
        'fwChart',
        'ftempChart',
        'socChart',
        'keChart',
        'bwChart',
        'bwhChart',
        'batteryVCChart',
        'batteryTempChart',
        'jvChart',
        'jcChart',
        'jwChart',
        'jwhChart'
    ];

    chartInstances.forEach(chartName => {
        if (window[chartName]) {
            window[chartName].data.labels = [];
            window[chartName].data.datasets.forEach(dataset => {
                dataset.data = [];
            });
            window[chartName].update('none');
        }
    });
}

// Kuyruk durumunu göster (debug için)
function getQueueStatus() {
    return {
        queueLength: dataQueue.length,
        isPageVisible: isPageVisible,
        isBackgroundFetching: backgroundFetchInterval !== null
    };
}

// Manuel kuyruk temizleme (gerekirse)
function clearDataQueue() {
    const oldLength = dataQueue.length;
    dataQueue = [];
    console.log(`🗑️ Kuyruk temizlendi. ${oldLength} veri silindi.`);
}