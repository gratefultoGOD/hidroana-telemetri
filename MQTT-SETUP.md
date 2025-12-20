# MQTT Entegrasyonu - Kurulum Rehberi

## 🎯 Genel Bakış

Uygulama artık HiveMQ Cloud üzerinden MQTT protokolü ile gerçek zamanlı telemetri verisi alıyor.

## 📋 Mimari

```
mqtt-publisher.js (Veri Gönderici)
         ↓
    HiveMQ Cloud Broker
         ↓
    server.js (Backend - Subscriber)
         ↓
    app.js (Frontend)
```

## 🔧 Kurulum Adımları

### 1. HiveMQ Cloud Broker Bilgilerini Güncelleme

**mqtt-publisher.js** ve **server.js** dosyalarında aşağıdaki bilgileri güncelleyin:

```javascript
const BROKER_URL = 'mqtt://your-broker-url.hivemq.cloud:8883';
const BROKER_OPTIONS = {
    username: 'your-username',
    password: 'your-password',
    protocol: 'mqtts',
    port: 8883
};
```

**Değiştirilmesi gerekenler:**
- `your-broker-url.hivemq.cloud` → HiveMQ Cloud broker URL'iniz
- `your-username` → HiveMQ Cloud kullanıcı adınız
- `your-password` → HiveMQ Cloud şifreniz

### 2. Bağımlılıkları Yükleme

```bash
npm install
```

## 🚀 Çalıştırma

### Terminal 1: Backend Server
```bash
npm start
```

Backend şunları yapar:
- Express server'ı başlatır (port 3000)
- MQTT broker'a bağlanır
- `hidroana/telemetry` topic'ine abone olur
- Gelen verileri `/api/telemetry` endpoint'inden sunar

### Terminal 2: MQTT Publisher (Veri Gönderici)
```bash
node mqtt-publisher.js
```

Publisher şunları yapar:
- HiveMQ Cloud broker'a bağlanır
- Her 1 saniyede bir fake telemetri verisi üretir
- Verileri `hidroana/telemetry` topic'ine gönderir

### Terminal 3: Tarayıcı
```
http://localhost:3000
```

## 📊 Gönderilen Veri Formatı

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "position": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "bearing": 45.5
  },
  "speed": 85,
  "voltage": 325.5,
  "watt": 2500,
  "current": 15.75,
  "wattHour": 350.5
}
```

## 🔍 Test ve Debugging

### MQTT Bağlantısını Test Etme

Publisher çalıştığında şu çıktıları görmelisiniz:
```
🔌 HiveMQ Cloud broker'a bağlanılıyor...
✅ MQTT broker'a bağlandı!
📡 Topic: hidroana/telemetry
🚀 Veri gönderimi başlıyor...
📤 Veri gönderildi: Speed=85 km/h, Pos=[40.7128, -74.0060]
```

Backend çalıştığında:
```
🔌 MQTT broker'a bağlanılıyor...
✅ MQTT broker'a bağlandı!
📡 Topic'e abone olundu: hidroana/telemetry
📥 Veri alındı: Speed=85 km/h
```

### Sorun Giderme

**Bağlantı hatası alıyorsanız:**
1. HiveMQ Cloud broker URL'ini kontrol edin
2. Kullanıcı adı ve şifrenin doğru olduğundan emin olun
3. HiveMQ Cloud dashboard'da broker'ın aktif olduğunu kontrol edin
4. Firewall ayarlarını kontrol edin (port 8883 açık olmalı)

**Veri gelmiyor:**
1. Publisher'ın çalıştığından emin olun
2. Backend'in MQTT'ye bağlı olduğunu kontrol edin
3. Topic adının her iki tarafta da aynı olduğunu doğrulayın

## 🔐 Güvenlik Notları

- Broker bilgilerini `.env` dosyasında saklayın (production için)
- `.gitignore` dosyasına `.env` ekleyin
- HiveMQ Cloud'da güçlü şifreler kullanın
- TLS/SSL kullanın (mqtts protokolü)

## 📝 Notlar

- Publisher her 1 saniyede veri gönderir
- Backend son alınan veriyi cache'ler
- Frontend her 1.5 saniyede backend'den veri çeker
- Rota üzerinde ileri-geri hareket simülasyonu yapılır
