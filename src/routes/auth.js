// ============================================
// AUTH API ROUTES (/api/login, /api/logout, /api/auth/check)
// ============================================
const express = require('express');
const { loadUsers } = require('../middleware/auth');

const router = express.Router();

router.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.userRole = user.role || 'user'; // Rol bilgisini session'a kaydet
        res.json({ success: true, message: 'Giriş başarılı', user: { id: user.id, username: user.username, role: user.role || 'user' } });
    } else {
        res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
});

router.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Çıkış yapılırken hata oluştu' });
        res.json({ success: true, message: 'Çıkış başarılı' });
    });
});

router.get('/api/auth/check', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username, role: req.session.userRole || 'user' } });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;
