/**
 * MINIMAL TEST SERVER
 * Sadece /data endpoint'i - maksimum performans testi için
 * 
 * Kullanım: node test-server.js
 * Test: curl "http://localhost:3001/data?key=066c4e702e&h=50"
 */

const http = require('http');

const PORT = 3000;
const KEY = '066c4e702e';

const server = http.createServer((req, res) => {
    // Sadece /data endpoint'i
    if (req.url.startsWith('/data')) {
        const startTime = process.hrtime.bigint();

        // Query string'den key kontrolü
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const key = url.searchParams.get('key');

        // Hemen 1 döndür
        res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Length': 1
        });
        res.end('1');

        // Performans logla
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1e6;
        const h = url.searchParams.get('h') || 'N/A';
        console.log(`⚡ /data: ${durationMs.toFixed(3)}ms | Hız=${h}`);

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('NOT FOUND');
    }
});

server.listen(PORT, () => {
});
