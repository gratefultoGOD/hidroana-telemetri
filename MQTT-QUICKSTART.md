# 🚀 MQTT Hızlı Başlangıç

## 1️⃣ Broker Bilgilerini Güncelle

**mqtt-publisher.js** ve **server.js** dosyalarında:

```javascript
const BROKER_URL = 'mqtt://BURAYA-BROKER-URL';
const BROKER_OPTIONS = {
    username: 'BURAYA-USERNAME',
    password: 'BURAYA-PASSWORD',
    protocol: 'mqtts',
    port: 8883
};
```

## 2️⃣ Üç Terminal Aç

### Terminal 1 - Backend
```bash
npm start
```

### Terminal 2 - Publisher (Veri Gönderici)
```bash
npm run publisher
```

### Terminal 3 - Tarayıcı
```
http://localhost:3000
```

## ✅ Başarılı Bağlantı Göstergeleri

**Publisher:**
```
✅ MQTT broker'a bağlandı!
📤 Veri gönderildi: Speed=85 km/h
```

**Backend:**
```
✅ MQTT broker'a bağlandı!
📥 Veri alındı: Speed=85 km/h
```

**Frontend:**
- Harita üzerinde hareket eden araç
- Gerçek zamanlı güncellenen grafikler
- MQTT'den gelen canlı veriler

## 🎉 Tamamlandı!

Artık uygulamanız MQTT üzerinden gerçek zamanlı veri alıyor!
