const fs = require('fs');
const path = require('path');
const readline = require('readline');

const USERS_FILE = path.join(__dirname, 'users.json');

// Readline interface oluştur
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Kullanıcıları yükle
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Kullanıcılar yüklenirken hata:', error);
    }
    return [];
}

// Kullanıcıları kaydet
function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Kullanıcılar kaydedilirken hata:', error);
        return false;
    }
}

// Soru sor
function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Ana fonksiyon
async function main() {
    console.log('\n🔐 Hidroana Telemetri - Kullanıcı Oluşturma\n');

    const users = loadUsers();

    // Mevcut kullanıcıları göster
    if (users.length > 0) {
        console.log('📋 Mevcut Kullanıcılar:');
        users.forEach((user, index) => {
            const roleLabel = user.role === 'admin' ? '👑 Admin' : '👤 User';
            console.log(`   ${index + 1}. ${user.username} - ${roleLabel} (ID: ${user.id})`);
        });
        console.log('');
    }

    // Yeni kullanıcı bilgilerini al
    const username = await question('Kullanıcı adı: ');

    if (!username || username.trim() === '') {
        console.log('❌ Kullanıcı adı boş olamaz!');
        rl.close();
        return;
    }

    // Kullanıcı adı kontrolü
    if (users.some(u => u.username === username)) {
        console.log('❌ Bu kullanıcı adı zaten mevcut!');
        rl.close();
        return;
    }

    const password = await question('Şifre: ');

    if (!password || password.trim() === '') {
        console.log('❌ Şifre boş olamaz!');
        rl.close();
        return;
    }

    // Rol seçimi
    console.log('\n📋 Kullanıcı Rolleri:');
    console.log('   1. admin  - Tüm yetkiler (veri kaynağı, test, kayıtlar)');
    console.log('   2. user   - Sadece izleme yetkisi');

    const roleChoice = await question('\nRol seçin (1 veya 2): ');

    let role;
    if (roleChoice === '1' || roleChoice.toLowerCase() === 'admin') {
        role = 'admin';
    } else if (roleChoice === '2' || roleChoice.toLowerCase() === 'user') {
        role = 'user';
    } else {
        console.log('❌ Geçersiz seçim! Varsayılan olarak "user" atandı.');
        role = 'user';
    }

    // Yeni kullanıcı oluştur
    const newUser = {
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
        username: username.trim(),
        password: password, // Gerçek uygulamada hash'lenmeli!
        role: role,
        createdAt: new Date().toISOString()
    };

    users.push(newUser);

    // Kaydet
    if (saveUsers(users)) {
        const roleLabel = newUser.role === 'admin' ? '👑 Admin' : '👤 User';
        console.log('\n✅ Kullanıcı başarıyla oluşturuldu!');
        console.log(`   ID: ${newUser.id}`);
        console.log(`   Kullanıcı Adı: ${newUser.username}`);
        console.log(`   Rol: ${roleLabel}`);
        console.log(`   Oluşturulma: ${new Date(newUser.createdAt).toLocaleString('tr-TR')}\n`);
    } else {
        console.log('\n❌ Kullanıcı kaydedilemedi!\n');
    }

    rl.close();
}

// Çalıştır
main();
