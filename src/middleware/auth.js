// ============================================
// KİMLİK DOĞRULAMA MIDDLEWARE'LERİ
// ============================================
const fs = require('fs');
const { USERS_FILE } = require('../config');

// users.json dosyasından kullanıcıları yükle
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        // Kullanıcılar yüklenemedi — boş liste döndür
    }
    return [];
}

// Giriş yapmış kullanıcı gerektir
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }
}

// Admin yetkisi gerektiren işlemler için middleware
function requireAdmin(req, res, next) {
    if (req.session && req.session.userId) {
        if (req.session.userRole === 'admin') {
            next();
        } else {
            res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekiyor' });
        }
    } else {
        res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }
}

module.exports = { loadUsers, requireAuth, requireAdmin };
