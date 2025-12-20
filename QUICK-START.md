# 🚀 Hızlı Başlangıç

## Sistem Şu Anda Çalışıyor! ✅

Sunucu başarıyla başlatıldı ve kullanıma hazır.

### 📍 Erişim Bilgileri

- **Ana Sayfa**: http://localhost:3000
- **Login Sayfası**: http://localhost:3000/login

### 🔐 Test Kullanıcısı

Sisteme giriş yapmak için hazır bir test kullanıcısı oluşturuldu:

```
Kullanıcı Adı: admin
Şifre: admin123
```

### 📝 Adım Adım Kullanım

1. **Tarayıcınızı açın** ve `http://localhost:3000` adresine gidin
2. **Login sayfasına** otomatik yönlendirileceksiniz
3. **Giriş yapın**:
   - Kullanıcı Adı: `admin`
   - Şifre: `admin123`
4. **Telemetri Dashboard'una** erişin ve sistemi kullanmaya başlayın!

### ➕ Yeni Kullanıcı Oluşturma

Yeni bir kullanıcı oluşturmak için:

```bash
npm run create-user
```

Komutunu çalıştırın ve soruları yanıtlayın:
- Kullanıcı adı girin
- Şifre girin
- Kullanıcı otomatik olarak oluşturulacak

### 🛑 Sunucuyu Durdurma

Sunucuyu durdurmak için terminalde `Ctrl + C` tuşlarına basın.

### 🔄 Sunucuyu Yeniden Başlatma

```bash
npm start
```

## 🎯 Özellikler

✅ **Login Sistemi**: Güvenli kullanıcı girişi
✅ **Session Yönetimi**: Oturum tabanlı kimlik doğrulama
✅ **Protected Routes**: Sadece giriş yapmış kullanıcılar erişebilir
✅ **Kullanıcı Yönetimi**: Backend'de kullanıcı oluşturma
✅ **Auto Redirect**: Otomatik yönlendirme
✅ **Logout**: Güvenli çıkış

## 📊 Telemetri Özellikleri

- Gerçek zamanlı hız göstergesi
- Harita üzerinde araç takibi
- Joulmetre verileri (Voltaj, Watt, Akım, Watt Saat)
- Grafik görselleştirme
- CSV/JSON veri dışa aktarma
- Grafik görüntülerini kaydetme

## 🔧 Sorun Giderme

### Port 3000 kullanımda hatası
Eğer port 3000 kullanımdaysa, `server.js` dosyasında PORT değişkenini değiştirin:
```javascript
const PORT = 3001; // veya başka bir port
```

### Kullanıcı girişi başarısız
- Kullanıcı adı ve şifrenin doğru olduğundan emin olun
- `users.json` dosyasının mevcut olduğunu kontrol edin
- Sunucuyu yeniden başlatın

## 💡 İpuçları

- Tarayıcınızın geliştirici konsolunu açarak (F12) hata mesajlarını görebilirsiniz
- Session 24 saat boyunca geçerlidir
- Çıkış yapmayı unutmayın!

---

**Keyifli Kullanımlar! 🚗💨**
