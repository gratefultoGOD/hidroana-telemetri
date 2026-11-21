// ============================================
// SSE (Server-Sent Events) CLIENT YÖNETİMİ
// Telemetri, lap ve realtime sector stream'leri
// ============================================
const state = require('../state');

const sseClients = new Set();        // Telemetri SSE client'ları
const urbanSseClients = new Set();   // URBAN aracı telemetri SSE client'ları
const lapSSEClients = new Set();     // Lap SSE client'ları
const raceSectorClients = new Set(); // /race sayfası realtime sector SSE client'ları

// Son realtime sector verisini sakla (yeni bağlanan client'a hemen gönder)
let lastRealtimeSectorPayload = null;

function getLastRealtimeSectorPayload() {
    return lastRealtimeSectorPayload;
}

// SSE bağlantısını hazırla — ortak header + heartbeat + cleanup
function setupSSEConnection(req, res, clientSet, { noDelay = false } = {}) {
    if (noDelay && req.socket) {
        // TCP Nagle algoritmasını devre dışı bırak — küçük paketler anında gönderilsin
        req.socket.setNoDelay(true);
        req.socket.setTimeout(0);
    }

    // SSE Headers — tüm proxy katmanlarına buffering'i kapat
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');   // Nginx için
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();

    clientSet.add(res);

    // Heartbeat - bağlantıyı canlı tut (her 30 saniyede)
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    // Client bağlantısı kesildiğinde temizle
    req.on('close', () => {
        clearInterval(heartbeat);
        clientSet.delete(res);
    });
}

// Telemetri broadcast - yeni veri geldiğinde tüm client'lara gönder
// Backpressure-aware: yavaş client'lar event loop'u bloklayamaz
function broadcastToClients(data) {
    if (sseClients.size === 0) return;

    const message = `data: ${JSON.stringify(data)}\n\n`;

    sseClients.forEach(client => {
        try {
            // res.write() false döndürürse TCP buffer dolu demektir
            // Bu durumda client yavaş — bırakılmalı, yoksa event loop bloklanır
            const ok = client.write(message);
            if (!ok && !client._sseSlowWarned) {
                // Yavaş client — bir şans daha ver ama drain'i bekle
                // Eğer drain 5 saniye içinde gelmezse bağlantıyı kes
                client._sseSlowWarned = true;
                const drainTimeout = setTimeout(() => {
                    console.log('⚠️ SSE yavaş client bağlantısı kesiliyor (drain timeout)');
                    try { client.end(); } catch (e) { /* ignore */ }
                    sseClients.delete(client);
                }, 5000);

                client.once('drain', () => {
                    clearTimeout(drainTimeout);
                    client._sseSlowWarned = false;
                });
            }
        } catch (error) {
            sseClients.delete(client);
        }
    });

    // SSE broadcast logu throttle — her 10 veride 1
    if (state.dataCounter % 10 === 0) {
        console.log(`📡 SSE broadcast: ${sseClients.size} client'a veri gönderildi`);
    }
}

// URBAN aracı telemetri broadcast - yeni veri geldiğinde tüm client'lara gönder
// Backpressure-aware: yavaş client'lar event loop'u bloklayamaz
function broadcastToUrbanClients(data) {
    if (urbanSseClients.size === 0) return;

    const message = `data: ${JSON.stringify(data)}\n\n`;

    urbanSseClients.forEach(client => {
        try {
            const ok = client.write(message);
            if (!ok && !client._sseSlowWarned) {
                client._sseSlowWarned = true;
                const drainTimeout = setTimeout(() => {
                    console.log('⚠️ URBAN SSE yavaş client bağlantısı kesiliyor (drain timeout)');
                    try { client.end(); } catch (e) { /* ignore */ }
                    urbanSseClients.delete(client);
                }, 5000);

                client.once('drain', () => {
                    clearTimeout(drainTimeout);
                    client._sseSlowWarned = false;
                });
            }
        } catch (error) {
            urbanSseClients.delete(client);
        }
    });

    if (state.urbanDataCounter % 10 === 0) {
        console.log(`📡 URBAN SSE broadcast: ${urbanSseClients.size} client'a veri gönderildi`);
    }
}

// Lap SSE broadcast — lapState servisten payload olarak gelir
function broadcastLapState(payload) {
    const message = `data: ${JSON.stringify(payload)}\n\n`;

    lapSSEClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            lapSSEClients.delete(client);
        }
    });

    if (lapSSEClients.size > 0) {
        console.log(`🏁 Lap SSE broadcast: ${lapSSEClients.size} client'a gönderildi`);
    }
}

// Realtime sector SSE broadcast
function broadcastSectorUpdate(payload) {
    lastRealtimeSectorPayload = payload;
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    raceSectorClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            raceSectorClients.delete(client);
        }
    });
    if (raceSectorClients.size > 0) {
        console.log(`🏁 Realtime sector broadcast: ${raceSectorClients.size} client'a gönderildi`);
    }
}

module.exports = {
    sseClients,
    urbanSseClients,
    lapSSEClients,
    raceSectorClients,
    setupSSEConnection,
    broadcastToClients,
    broadcastToUrbanClients,
    broadcastLapState,
    broadcastSectorUpdate,
    getLastRealtimeSectorPayload
};
