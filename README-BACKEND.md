# Hidroana Telemetri - Backend ve Login Sistemi

## 🚀 Kurulum

### 1. Bağımlılıkları Yükleyin
```bash
npm install
```

### 2. Kullanıcı Oluşturun
Backend'de kullanıcı oluşturmak için:
```bash
npm run create-user
```

Örnek kullanıcı oluşturma:
```
Kullanıcı adı: admin
Şifre: admin123
```

### 3. Sunucuyu Başlatın
```bash
npm start
```

Sunucu `http://localhost:3000` adresinde çalışacaktır.

## 📋 Kullanım

### Login
1. Tarayıcınızda `http://localhost:3000` adresine gidin
2. Otomatik olarak login sayfasına yönlendirileceksiniz
3. Oluşturduğunuz kullanıcı adı ve şifre ile giriş yapın

### Telemetri Sistemi
- Giriş yaptıktan sonra telemetri dashboard'una erişebilirsiniz
- Sağ üstteki kullanıcı adınızı görebilirsiniz
- "Çıkış" butonuna tıklayarak oturumu kapatabilirsiniz

## 🔐 Güvenlik Özellikleri

- **Session Tabanlı Authentication**: Express-session kullanılarak güvenli oturum yönetimi
- **Protected Routes**: Telemetri sayfalarına sadece giriş yapmış kullanıcılar erişebilir
- **Kullanıcı Yönetimi**: Kullanıcılar sadece backend'de oluşturulabilir
- **Auto Redirect**: Giriş yapmamış kullanıcılar otomatik olarak login sayfasına yönlendirilir

## 📁 Dosya Yapısı

```
.
├── server.js              # Express backend sunucusu
├── create-user.js         # Kullanıcı oluşturma scripti
├── users.json            # Kullanıcı veritabanı (otomatik oluşturulur)
├── login.html            # Login sayfası
├── index.html            # Ana telemetri sayfası
├── app.js                # Frontend JavaScript
├── styles.css            # CSS stilleri
└── package.json          # NPM bağımlılıkları
```

## 🔧 API Endpoints

### POST /api/login
Kullanıcı girişi yapar.
```json
{
  "username": "admin",
  "password": "admin123"
}
```

### POST /api/logout
Kullanıcı çıkışı yapar.

### GET /api/auth/check
Kullanıcının giriş durumunu kontrol eder.

## 💡 Notlar

- Kullanıcı şifreleri şu an düz metin olarak saklanıyor (geliştirme amaçlı)
- Production ortamında bcrypt ile hash'lenmeli
- Session secret'ı production'da değiştirilmeli
- HTTPS kullanılıyorsa cookie.secure: true yapılmalı

## 🎯 Gelecek Geliştirmeler

- [ ] Şifre hash'leme (bcrypt)
- [ ] Kullanıcı rolleri (admin, user)
- [ ] Şifre sıfırlama
- [ ] Kullanıcı profil yönetimi
- [ ] MQTT entegrasyonu
- [ ] WebSocket ile gerçek zamanlı veri
