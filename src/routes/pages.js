// ============================================
// SAYFA ROUTES (HTML dosyaları)
// ============================================
const express = require('express');
const path = require('path');

const { ROOT_DIR } = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getCookie } = require('../utils/helpers');

const router = express.Router();

const VEHICLE_COOKIE = 'vehicleSettings';

// no-store cache başlığı ile HTML dosyası gönder
function servePage(fileName) {
    return (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.sendFile(path.join(ROOT_DIR, fileName));
    };
}

// vehicleSettings cookie'sini oku — geçerli değilse null döner
function readVehicleCookie(req) {
    const raw = getCookie(req, VEHICLE_COOKIE);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.vehicle === 'proto' || parsed.vehicle === 'urban')) {
            return parsed;
        }
    } catch (e) { /* bozuk cookie — ayarlar sayfasına yönlendir */ }
    return null;
}

router.get('/login', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'login.html'));
});

router.get('/settings', requireAuth, servePage('settings.html'));

router.get('/fullmap', servePage('mobile.html'));
router.get('/sectors', requireAdmin, servePage('sectors.html'));
router.get('/race', requireAuth, servePage('race.html'));
router.get('/laps', requireAuth, servePage('laps.html'));
router.get('/play', requireAuth, servePage('play.html'));
router.get('/flow', requireAdmin, servePage('flow.html'));
router.get('/3dview', requireAuth, servePage('3dview.html'));

router.get('/urban', requireAuth, (req, res, next) => {
    if (!readVehicleCookie(req)) return res.redirect('/settings');
    next();
}, servePage('telemetriV2/dist/index.html'));
router.use('/urban', requireAuth, express.static(path.join(ROOT_DIR, 'telemetriV2/dist'), { index: false }));

router.get('/', (req, res) => {
    if (!(req.session && req.session.userId)) {
        return res.redirect('/login');
    }

    const settings = readVehicleCookie(req);
    if (!settings) return res.redirect('/settings');
    if (settings.vehicle === 'urban') return res.redirect('/urban');

    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

module.exports = router;
