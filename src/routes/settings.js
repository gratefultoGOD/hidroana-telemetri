// ============================================
// SİSTEM AYARLARI API ROUTES
// Aktif araç (proto/urban) ve veri kanalı (MQTT/HTTP) seçimini yönetir
// ============================================
const express = require('express');

const dataSource = require('../services/dataSource');
const systemSettings = require('../services/systemSettings');
const testModeService = require('../services/testMode');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COOKIE_NAME = 'vehicleSettings';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 yıl

// Mevcut ayarları döndür (settings.html sayfasını doldurmak için)
router.get('/api/settings', requireAuth, (req, res) => {
    res.json({
        vehicle: systemSettings.getActiveVehicle(),
        channel: dataSource.getDataSource()
    });
});

// Ayarları güncelle — SADECE giriş yapmış kullanıcı (tüm ekip için ortak istasyon ayarı)
router.post('/api/settings', requireAuth, (req, res) => {
    const { vehicle, channel } = req.body || {};

    if (vehicle !== 'proto' && vehicle !== 'urban') {
        return res.status(400).json({ error: "Geçersiz araç. 'proto' veya 'urban' olmalı." });
    }
    if (channel !== 'MQTT' && channel !== 'HTTP') {
        return res.status(400).json({ error: "Geçersiz protokol. 'MQTT' veya 'HTTP' olmalı." });
    }
    if (testModeService.testMode.active) {
        return res.status(409).json({ error: 'Aktif bir test kaydı sürerken ayarlar değiştirilemez. Önce testi durdurun.' });
    }

    systemSettings.setActiveVehicle(vehicle);
    const switchResult = dataSource.switchDataSource(channel);
    systemSettings.persistSettings(vehicle, channel);

    console.log(`⚙️ Sistem ayarları güncellendi: araç=${vehicle}, kanal=${channel} (${req.session.username})`);

    res.cookie(COOKIE_NAME, JSON.stringify({ vehicle, channel }), {
        maxAge: COOKIE_MAX_AGE,
        httpOnly: false,
        sameSite: 'strict',
        secure: false,
        path: '/'
    });

    res.json({
        success: true,
        vehicle,
        channel,
        sourceMessage: switchResult.message,
        redirect: vehicle === 'urban' ? '/urban' : '/'
    });
});

module.exports = router;
