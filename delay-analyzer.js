/**
 * Telemetri Veri Gecikme Analizörü
 * ================================
 * Test verilerinin arasındaki gecikmeyi (interval) ölçer ve analiz eder.
 * 
 * Kullanım:
 *   node delay-analyzer.js                    -> Tüm test dosyalarını analiz et
 *   node delay-analyzer.js test_dosyasi.csv   -> Belirli bir dosyayı analiz et
 *   node delay-analyzer.js --live             -> Canlı veri akışını izle
 *   node delay-analyzer.js --live --duration=60  -> 60 saniye canlı izle
 */

const fs = require('fs');
const path = require('path');

// Ayarlar
const TEST_DIR = path.join(__dirname, 'test_data');
const DATA_DIR = path.join(__dirname, 'telemetry_data');

// Renk kodları (terminal için)
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

// Yardımcı fonksiyonlar
function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

function parseTimeToMs(timeStr) {
    // Format: HH:MM:SS.mmm veya HH:MM:SS
    const parts = timeStr.split(':');
    if (parts.length < 3) return null;

    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const secParts = parts[2].split('.');
    const seconds = parseInt(secParts[0]);
    const milliseconds = secParts.length > 1 ? parseInt(secParts[1].padEnd(3, '0').slice(0, 3)) : 0;

    return (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + milliseconds;
}

function formatMs(ms) {
    if (ms < 1000) {
        return `${ms.toFixed(2)} ms`;
    } else {
        return `${(ms / 1000).toFixed(3)} s`;
    }
}

function calculateStats(delays) {
    if (delays.length === 0) return null;

    const sorted = [...delays].sort((a, b) => a - b);
    const sum = delays.reduce((a, b) => a + b, 0);
    const mean = sum / delays.length;

    // Standart sapma
    const squaredDiffs = delays.map(d => Math.pow(d - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / delays.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // Percentiller
    const percentile = (p) => {
        const index = Math.ceil(p / 100 * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    };

    // Jitter (ardışık gecikmeler arasındaki fark)
    const jitters = [];
    for (let i = 1; i < delays.length; i++) {
        jitters.push(Math.abs(delays[i] - delays[i - 1]));
    }
    const avgJitter = jitters.length > 0 ? jitters.reduce((a, b) => a + b, 0) / jitters.length : 0;

    return {
        count: delays.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: mean,
        median: percentile(50),
        stdDev: stdDev,
        p95: percentile(95),
        p99: percentile(99),
        jitter: avgJitter,
        totalTime: sum,
        histogram: calculateHistogram(delays)
    };
}

function calculateHistogram(delays, bucketCount = 10) {
    if (delays.length === 0) return [];

    const min = Math.min(...delays);
    const max = Math.max(...delays);
    const bucketSize = (max - min) / bucketCount || 1;

    const buckets = Array(bucketCount).fill(0);

    delays.forEach(d => {
        let bucketIndex = Math.floor((d - min) / bucketSize);
        if (bucketIndex >= bucketCount) bucketIndex = bucketCount - 1;
        buckets[bucketIndex]++;
    });

    return buckets.map((count, i) => ({
        rangeStart: min + i * bucketSize,
        rangeEnd: min + (i + 1) * bucketSize,
        count: count,
        percentage: (count / delays.length * 100).toFixed(1)
    }));
}

function drawHistogram(histogram) {
    console.log('\n' + colorize('📊 Gecikme Dağılımı (Histogram)', 'cyan'));
    console.log('─'.repeat(60));

    const maxCount = Math.max(...histogram.map(b => b.count));
    const barWidth = 30;

    histogram.forEach(bucket => {
        const barLength = Math.round(bucket.count / maxCount * barWidth);
        const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
        const rangeLabel = `${formatMs(bucket.rangeStart).padStart(10)} - ${formatMs(bucket.rangeEnd).padEnd(10)}`;
        console.log(`${rangeLabel} │${colorize(bar, 'green')}│ ${bucket.count} (${bucket.percentage}%)`);
    });
}

// CSV dosyasını analiz et
function analyzeCSVFile(filePath, isTestFile = false) {
    if (!fs.existsSync(filePath)) {
        console.log(colorize(`❌ Dosya bulunamadı: ${filePath}`, 'red'));
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    // BOM karakterini temizle
    const cleanContent = content.replace(/^\uFEFF/, '');
    const lines = cleanContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
        console.log(colorize(`⚠️ Yeterli veri yok: ${path.basename(filePath)}`, 'yellow'));
        return null;
    }

    const headers = lines[0].split(';').map(h => h.trim());
    const timeIndex = headers.indexOf('time');
    const testTimeIndex = headers.indexOf('test_time');

    // Zaman verilerini çıkar
    const timestamps = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(';');

        if (isTestFile && testTimeIndex !== -1) {
            // Test dosyası için test_time kullan
            const testTime = values[testTimeIndex]?.trim();
            if (testTime) {
                const ms = parseTimeToMs(testTime);
                if (ms !== null) timestamps.push(ms);
            }
        } else if (timeIndex !== -1) {
            // Normal dosya için time kullan
            const time = values[timeIndex]?.trim();
            if (time) {
                const ms = parseTimeToMs(time);
                if (ms !== null) timestamps.push(ms);
            }
        }
    }

    if (timestamps.length < 2) {
        console.log(colorize(`⚠️ Yeterli zaman damgası yok: ${path.basename(filePath)}`, 'yellow'));
        return null;
    }

    // Ardışık zaman farkları (gecikmeler) hesapla
    const delays = [];
    for (let i = 1; i < timestamps.length; i++) {
        const delay = timestamps[i] - timestamps[i - 1];
        if (delay > 0 && delay < 60000) { // 0-60 saniye arası geçerli
            delays.push(delay);
        }
    }

    return {
        fileName: path.basename(filePath),
        totalRecords: lines.length - 1,
        validDelays: delays.length,
        stats: calculateStats(delays),
        delays: delays
    };
}

function printAnalysisResult(result) {
    const s = result.stats;

    console.log('\n' + colorize('═'.repeat(60), 'cyan'));
    console.log(colorize(`📁 Dosya: ${result.fileName}`, 'bright'));
    console.log(colorize('═'.repeat(60), 'cyan'));

    console.log(`\n${colorize('📈 Genel Bilgiler', 'yellow')}`);
    console.log(`   Toplam Kayıt:     ${result.totalRecords}`);
    console.log(`   Geçerli Aralık:   ${result.validDelays}`);
    console.log(`   Toplam Süre:      ${formatMs(s.totalTime)}`);

    console.log(`\n${colorize('⏱️ Gecikme İstatistikleri', 'yellow')}`);
    console.log(`   Minimum:          ${colorize(formatMs(s.min), 'green')}`);
    console.log(`   Maksimum:         ${colorize(formatMs(s.max), 'red')}`);
    console.log(`   Ortalama:         ${colorize(formatMs(s.mean), 'cyan')}`);
    console.log(`   Medyan:           ${formatMs(s.median)}`);
    console.log(`   Standart Sapma:   ${formatMs(s.stdDev)}`);

    console.log(`\n${colorize('📊 Yüzdelikler', 'yellow')}`);
    console.log(`   P95:              ${formatMs(s.p95)}`);
    console.log(`   P99:              ${formatMs(s.p99)}`);
    console.log(`   Jitter (Ort):     ${formatMs(s.jitter)}`);

    // Beklenen frekans hesapla
    const expectedFreq = 1000 / s.mean;
    console.log(`\n${colorize('📡 Veri Frekansı', 'yellow')}`);
    console.log(`   Ortalama Frekans: ${colorize(expectedFreq.toFixed(2) + ' Hz', 'magenta')}`);
    console.log(`   Veri/saniye:      ${colorize((1000 / s.mean).toFixed(2), 'magenta')}`);

    // Alarm eşikleri
    console.log(`\n${colorize('🚨 Değerlendirme', 'yellow')}`);
    if (s.mean <= 250) {
        console.log(`   ✅ ${colorize('MÜKEMMEL', 'green')} - Ortalama gecikme çok düşük`);
    } else if (s.mean <= 500) {
        console.log(`   ✅ ${colorize('İYİ', 'green')} - Ortalama gecikme kabul edilebilir`);
    } else if (s.mean <= 1000) {
        console.log(`   ⚠️ ${colorize('ORTA', 'yellow')} - Gecikme biraz yüksek`);
    } else {
        console.log(`   ❌ ${colorize('KÖTÜ', 'red')} - Gecikme çok yüksek`);
    }

    if (s.stdDev > s.mean * 0.5) {
        console.log(`   ⚠️ ${colorize('YÜKSEK SAPMA', 'yellow')} - Veriler tutarsız`);
    } else {
        console.log(`   ✅ ${colorize('DÜŞÜK SAPMA', 'green')} - Veriler tutarlı`);
    }

    // Histogram çiz
    if (s.histogram && s.histogram.length > 0) {
        drawHistogram(s.histogram);
    }
}

// Canlı izleme modu
async function startLiveMonitoring(durationSeconds = 0) {
    console.log('\n' + colorize('🔴 CANLI GECİKME İZLEME MODU', 'red'));
    console.log('─'.repeat(60));
    console.log(`   Hedef: https://telemetri.hidroana.com/api/telemetry`);
    console.log(`   Süre:  ${durationSeconds > 0 ? durationSeconds + ' saniye' : 'Sınırsız (Ctrl+C ile dur)'}`);
    console.log('─'.repeat(60) + '\n');

    const delays = [];
    let lastDataCounter = null;
    let lastTime = null;
    let requestCount = 0;
    let errorCount = 0;

    const startTime = Date.now();
    const endTime = durationSeconds > 0 ? startTime + (durationSeconds * 1000) : Infinity;

    const interval = setInterval(async () => {
        if (Date.now() >= endTime) {
            clearInterval(interval);

            // Sonuçları göster
            console.log('\n' + colorize('📊 CANLI İZLEME SONUÇLARI', 'cyan'));
            console.log('═'.repeat(60));

            if (delays.length > 0) {
                const stats = calculateStats(delays);
                console.log(`\n   Toplam İstek:     ${requestCount}`);
                console.log(`   Hata:             ${errorCount}`);
                console.log(`   Ölçülen Aralık:   ${delays.length}`);
                console.log(`\n   Min Gecikme:      ${colorize(formatMs(stats.min), 'green')}`);
                console.log(`   Max Gecikme:      ${colorize(formatMs(stats.max), 'red')}`);
                console.log(`   Ortalama:         ${colorize(formatMs(stats.mean), 'cyan')}`);
                console.log(`   Std Sapma:        ${formatMs(stats.stdDev)}`);
                console.log(`   Jitter:           ${formatMs(stats.jitter)}`);

                drawHistogram(stats.histogram);
            } else {
                console.log(colorize('\n   Yeterli veri toplanamadı.', 'yellow'));
            }

            process.exit(0);
            return;
        }

        try {
            const fetchStart = Date.now();
            const response = await fetch('https://telemetri.hidroana.com/api/telemetry');

            requestCount++;

            if (!response.ok) {
                errorCount++;
                return;
            }

            const data = await response.json();
            const now = Date.now();

            if (data.dataCounter !== undefined && data.dataCounter !== lastDataCounter) {
                // Yeni veri geldi
                if (lastTime !== null) {
                    const delay = now - lastTime;
                    delays.push(delay);

                    // Canlı gösterim
                    const avgDelay = delays.length > 0
                        ? delays.reduce((a, b) => a + b, 0) / delays.length
                        : 0;

                    process.stdout.write(`\r   #${data.dataCounter.toString().padStart(5)} | ` +
                        `Gecikme: ${formatMs(delay).padStart(10)} | ` +
                        `Ort: ${formatMs(avgDelay).padStart(10)} | ` +
                        `Hız: ${(data.h || 0).toString().padStart(3)} km/h | ` +
                        `SOC: ${(data.soc || 0).toString().padStart(5)}%`);
                }

                lastDataCounter = data.dataCounter;
                lastTime = now;
            }
        } catch (error) {
            errorCount++;
        }
    }, 50); // Her 50ms'de bir kontrol et
}

// Ana fonksiyon
async function main() {
    const args = process.argv.slice(2);

    console.log('\n' + colorize('╔════════════════════════════════════════════════════════╗', 'cyan'));
    console.log(colorize('║      TELEMETRY VERİ GECİKME ANALİZÖRÜ                  ║', 'cyan'));
    console.log(colorize('╚════════════════════════════════════════════════════════╝', 'cyan'));

    // Canlı izleme modu
    if (args.includes('--live')) {
        const durationArg = args.find(a => a.startsWith('--duration='));
        const duration = durationArg ? parseInt(durationArg.split('=')[1]) : 0;
        await startLiveMonitoring(duration);
        return;
    }

    // Belirli dosya analizi
    if (args.length > 0 && !args[0].startsWith('--')) {
        const fileName = args[0];
        let filePath;

        if (fs.existsSync(fileName)) {
            filePath = fileName;
        } else if (fs.existsSync(path.join(TEST_DIR, fileName))) {
            filePath = path.join(TEST_DIR, fileName);
        } else if (fs.existsSync(path.join(DATA_DIR, fileName))) {
            filePath = path.join(DATA_DIR, fileName);
        } else {
            console.log(colorize(`\n❌ Dosya bulunamadı: ${fileName}`, 'red'));
            return;
        }

        const isTest = filePath.includes('test_') || filePath.includes(TEST_DIR);
        const result = analyzeCSVFile(filePath, isTest);

        if (result && result.stats) {
            printAnalysisResult(result);
        }
        return;
    }

    // Tüm test dosyalarını analiz et
    console.log('\n' + colorize('🔍 Test Dosyaları Analiz Ediliyor...', 'yellow'));

    if (!fs.existsSync(TEST_DIR)) {
        console.log(colorize('\n⚠️ Test klasörü bulunamadı: ' + TEST_DIR, 'yellow'));
        console.log('\nKullanım:');
        console.log('  node delay-analyzer.js                    -> Tüm test dosyalarını analiz et');
        console.log('  node delay-analyzer.js test_dosyasi.csv   -> Belirli bir dosyayı analiz et');
        console.log('  node delay-analyzer.js --live             -> Canlı veri akışını izle');
        console.log('  node delay-analyzer.js --live --duration=60  -> 60 saniye canlı izle');
        return;
    }

    const testFiles = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.csv'));

    if (testFiles.length === 0) {
        console.log(colorize('\n⚠️ Test dosyası bulunamadı.', 'yellow'));
        return;
    }

    console.log(`   ${testFiles.length} test dosyası bulundu.\n`);

    // Özet tablo
    const allResults = [];

    testFiles.forEach(file => {
        const filePath = path.join(TEST_DIR, file);
        const result = analyzeCSVFile(filePath, true);

        if (result && result.stats) {
            allResults.push(result);
            printAnalysisResult(result);
        }
    });

    // Genel özet
    if (allResults.length > 1) {
        console.log('\n\n' + colorize('╔════════════════════════════════════════════════════════╗', 'magenta'));
        console.log(colorize('║                 GENEL ÖZET                              ║', 'magenta'));
        console.log(colorize('╚════════════════════════════════════════════════════════╝', 'magenta'));

        const allMeans = allResults.map(r => r.stats.mean);
        const allMins = allResults.map(r => r.stats.min);
        const allMaxs = allResults.map(r => r.stats.max);

        console.log(`\n   Analiz Edilen Dosya: ${allResults.length}`);
        console.log(`   Toplam Veri:         ${allResults.reduce((a, r) => a + r.totalRecords, 0)}`);
        console.log(`\n   Global Min:          ${colorize(formatMs(Math.min(...allMins)), 'green')}`);
        console.log(`   Global Max:          ${colorize(formatMs(Math.max(...allMaxs)), 'red')}`);
        console.log(`   Genel Ortalama:      ${colorize(formatMs(allMeans.reduce((a, b) => a + b, 0) / allMeans.length), 'cyan')}`);
    }
}

// Programı başlat
main().catch(console.error);
