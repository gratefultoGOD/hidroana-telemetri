// ============================================
// STATİK DOSYA ERİŞİM KONTROLÜ
// Hassas dosyaları engeller, veri dizinlerini admin'e kısıtlar
// ============================================

function serveStaticWithAuth(req, res, next) {
    const blockedFiles = [
        '/users.json', '/vehicle_settings.json', '/package.json', '/package-lock.json', '/server.js',
        '/create-user.js', '/clientmqtt.js', '/.env', '/node_modules', '/src',
        '/sectors.html', '/race.html', '/laps.html', '/play.html', '/telemetriV2'
    ];
    if (blockedFiles.some(blocked => req.path.startsWith(blocked))) {
        return res.status(403).send('Forbidden');
    }

    // Veri dizinlerine doğrudan erişim SADECE ADMIN için (dosya yolu ile indirme engeli)
    const adminOnlyDirs = ['/telemetry_data/', '/test_data/', '/races_data/', '/sectors_data/'];
    if (adminOnlyDirs.some(dir => req.path.startsWith(dir))) {
        if (req.session && req.session.userId && req.session.userRole === 'admin') {
            return next();
        }
        return res.status(403).json({ error: 'Bu dosyalara erişim için admin yetkisi gerekiyor' });
    }

    if (req.path.match(/\.(css|js|jpg|jpeg|gif|ico|svg)$/)) {
        if (req.session && req.session.userId) next();
        else res.status(401).send('Unauthorized');
    } else {
        next();
    }
}

module.exports = { serveStaticWithAuth };
