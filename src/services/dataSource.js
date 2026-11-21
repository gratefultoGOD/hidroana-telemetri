// ============================================
// VERİ KAYNAĞI YÖNETİMİ (MQTT / HTTP)
// ============================================
const mqtt = require('mqtt');

const config = require('../config');
const state = require('../state');
const { addFlowToBuffer, parseFlowValue } = require('./flow');
const { broadcastToClients } = require('./sse');
const { parseStarSeparatedData, processIncomingData, parseUrbanStarSeparatedData, processIncomingUrbanData } = require('./dataPipeline');
const { getActiveVehicle } = require('./systemSettings');

let DATA_SOURCE = config.DEFAULT_DATA_SOURCE;
let mqttClient = null;
let httpModeActive = false;

// ============================================
// MQTT BAĞLANTISI
// ============================================
function startMQTT() {
    console.log('MQTT broker bağlanılıyor...');
    mqttClient = mqtt.connect(config.MQTT_BROKER_URL, config.MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        // TCP Nagle algoritmasını kapat — küçük MQTT paketleri biriktirilmeden anında gelsin
        if (mqttClient.stream) {
            mqttClient.stream.setNoDelay(true);
            console.log('⚡ MQTT TCP_NODELAY aktif');
        }
        console.log('MQTT broker bağlandı!');
        state.connectionStatus.connected = true;

        [config.MQTT_TOPIC, config.MQTT_FLOW_TOPIC].forEach(topic => {
            mqttClient.subscribe(topic, { qos: 0 }, (error) => {
                if (!error) {
                    console.log(`📡 Topice abone olundu: ${topic}`);
                }
            });
        });
    });

    mqttClient.on('message', (topic, message) => {
        const receivedAt = Date.now();
        try {
            if (topic === config.MQTT_TOPIC) {
                const rawMessage = message.toString().trim();
                // HAM VERİ logu yok — her mesajda stdout yazımı event loop'u bloklar
                // Tek topic ('data') — hangi araç/string formatının bekleneceği
                // ayarlar sayfasından seçilen aktif araca göre belirlenir
                if (getActiveVehicle() === 'urban') {
                    const data = parseUrbanStarSeparatedData(rawMessage);
                    processIncomingUrbanData(data, receivedAt);
                } else {
                    const data = parseStarSeparatedData(rawMessage);
                    processIncomingData(data);
                }
            }

            if (topic === config.MQTT_FLOW_TOPIC) {
                const rawFlow = message.toString().trim();
                const flowTimestamp = Date.now();
                // rawFlow string'ini buffer'a ekle ("anlık*toplam" formatı)
                addFlowToBuffer(rawFlow, flowTimestamp);

                // data topic'ini beklemeden anlık olarak SSE'ye gönder
                const { instantFlow, totalFlow } = parseFlowValue(rawFlow);
                broadcastToClients({
                    type: 'flow_update',
                    hasRealFlow: true,
                    realInstantFlow: instantFlow,
                    realTotalFlow: totalFlow,
                    flowTimestamp
                });
            }

            // 250ms sonra supercapacitor durumunu MQTT_TAKE topic'ine gönder
            setTimeout(() => {
                if (mqttClient && mqttClient.connected) {
                    mqttClient.publish(config.MQTT_TAKE, state.supercapacitor ? '1' : '0', { qos: 1 });
                    console.log(`📤 MQTT_TAKE gönderildi: ${state.supercapacitor ? '1' : '0'}`);
                }
            }, 250);
        } catch (error) {
            // Mesaj parse hatası — veri atlanır
        }
    });

    mqttClient.on('error', (error) => {
        state.connectionStatus.connected = false;
        state.connectionStatus.error = error.message;
    });

    mqttClient.on('offline', () => {
        console.log(' MQTT bağlantısı kesildi');
        state.connectionStatus.connected = false;
    });

    mqttClient.on('reconnect', () => {
        console.log('MQTT yeniden bağlanıyor...');
    });
}

function stopMQTT() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        console.log(' MQTT bağlantısı kapatıldı');
    }
}

// ============================================
// HTTP MODE (Araç bize GET isteği yapar)
// ============================================
function startHTTP() {
    httpModeActive = true;
    console.log('HTTP modu aktif - Araçtan veri bekleniyor...');
    console.log('Endpoint: GET /data?key=...&h=...&x=...&y=...');
}

function stopHTTP() {
    httpModeActive = false;
    console.log('HTTP modu kapatıldı');
}

// ============================================
// KAYNAK GEÇİŞİ
// ============================================
function switchDataSource(newSource) {
    if (newSource !== 'MQTT' && newSource !== 'HTTP') {
        return { success: false, error: 'Geçersiz kaynak. MQTT veya HTTP olmalı.' };
    }

    if (newSource === DATA_SOURCE) {
        return { success: true, message: `Zaten ${newSource} modunda` };
    }

    // Mevcut kaynağı durdur
    if (DATA_SOURCE === 'MQTT') {
        stopMQTT();
    } else {
        stopHTTP();
    }

    // Yeni kaynağı başlat
    DATA_SOURCE = newSource;
    state.connectionStatus.source = newSource;
    state.connectionStatus.connected = false;

    if (newSource === 'MQTT') {
        startMQTT();
    } else {
        startHTTP();
    }

    console.log(`Veri kaynağı değiştirildi: ${newSource}`);
    return { success: true, message: `Veri kaynağı ${newSource} olarak değiştirildi` };
}

// Başlangıçta veri kaynağını başlat
function initDataSource() {
    console.log(`\n Veri kaynağı: ${DATA_SOURCE}`);
    if (DATA_SOURCE === 'MQTT') {
        startMQTT();
    } else {
        startHTTP();
    }
}

// Sunucu ilk açılırken kalıcı ayarlardan (vehicle_settings.json) kaynağı
// geri yükler — initDataSource() çağrılmadan ÖNCE kullanılmalı.
// switchDataSource'ın aksine bağlantı başlatmaz/durdurmaz, sadece
// başlangıç değerini ayarlar (çift bağlantı açılmasını önler).
function setInitialSource(source) {
    if (source === 'MQTT' || source === 'HTTP') {
        DATA_SOURCE = source;
        state.connectionStatus.source = source;
    }
}

module.exports = {
    initDataSource,
    switchDataSource,
    setInitialSource,
    getDataSource: () => DATA_SOURCE
};
