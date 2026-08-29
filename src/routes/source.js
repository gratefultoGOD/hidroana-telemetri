// ============================================
// VERİ KAYNAĞI API ROUTES (/api/source/*, /capacitor, /data)
// ============================================
const express = require('express');

const config = require('../config');
const state = require('../state');
const dataSource = require('../services/dataSource');
const { processIncomingData, processIncomingUrbanData } = require('../services/dataPipeline');
const { parseUrbanHttpQuery } = require('../services/urbanPayload');
const { getActiveVehicle } = require('../services/systemSettings');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// OPTİMİZE EDİLMİŞ /data ENDPOINT
// 2G GSM için minimum gecikme — server.js'te middleware'lerden ÖNCE mount edilir
// ============================================
const dataRouter = express.Router();

dataRouter.get('/data', (req, res) => {
    // Performans ölçümü
    const startTime = process.hrtime.bigint();
    const receivedAt = Date.now();

    if (dataSource.getDataSource() !== 'HTTP') {
        return res.status(400).send('DISABLED');
    }

    const q = req.query;

    // KEY kontrolünü hemen yap
    if (q.key !== config.API_KEY || !q.key) {
        console.log('⚠️ Unauthorized access detected');
        return res.status(401).send('UNAUTHORIZED');
    }

    const activeVehicle = getActiveVehicle();
    if (activeVehicle === 'urban' && q.s !== undefined && q.s !== '0' && q.s !== '1') {
        return res.status(400).send('INVALID_S');
    }

    // ÖNCE CEVABI GÖNDER - minimum latency için kritik
    res.removeHeader('X-Powered-By');
    // Supercapacitor durumuna göre yanıt
    if (state.supercapacitor) {
        res.setHeader('Content-Length', 1);
        res.status(200).send('1');
    } else {
        res.setHeader('Content-Length', 0);
        res.status(200).send('');
    }

    // Performans logla
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;

    // SONRA asenkron olarak veriyi işle (non-blocking)
    // Hangi araç formatının bekleneceği ayarlar sayfasından seçilen
    // aktif araca göre belirlenir — endpoint/key aynı kalır
    setImmediate(() => {
        if (activeVehicle === 'urban') {
            const data = parseUrbanHttpQuery(q);

            processIncomingUrbanData(data, receivedAt, { source: 'HTTP', startNewFile: q.s === '1' });
            console.log(`⚡ [URBAN] /data response: ${durationMs.toFixed(2)}ms | Hız=${data.h}`);
            return;
        }

        const data = {
            h: q.h || null,
            x: q.x || null,
            y: q.y || null,
            gp: q.gp || null,
            gs: q.gs || null,
            fv: q.fv || null,
            fa: q.fa || null,
            fw: q.fw || null,
            fet: q.fet || null,
            fit: q.fit || null,
            kz: q.kz || null,
            bv: q.bv || null,
            bc: q.bc || null,
            bw: q.bw || null,
            bwh: q.bwh || null,
            t1: q.t1 || null,
            t2: q.t2 || null,
            t3: q.t3 || null,
            soc: q.soc || null,
            ke: q.ke || null,
            jv: q.jv || null,
            jc: q.jc || null,
            jw: q.jw || null,
            jwh: q.jwh || null,
            mt: q.mt || null,
            id: q.id || null,
            gx: q.gx || null,
            gy: q.gy || null,
            gz: q.gz || null,
            gsmspeed: q.gsmspeed || null
        };

        processIncomingData(data);
        console.log(`⚡ /data response: ${durationMs.toFixed(2)}ms | Hız=${data.h}`);
    });
});

// ============================================
// KAYNAK DURUMU / GEÇİŞİ
// ============================================
router.get('/api/source/status', requireAuth, (req, res) => {
    // Son veri alım zamanını kontrol et
    const now = Date.now();
    const lastDataTime = state.latestTelemetryData?.receivedAt || 0;
    const timeSinceLastData = now - lastDataTime;

    // 5 saniyeden fazla veri gelmemişse bağlantı kesildi olarak işaretle
    const isDataFlowing = timeSinceLastData <= 5000 && !!state.latestTelemetryData;

    res.json({
        ...state.connectionStatus,
        connected: isDataFlowing,
        timeSinceLastData: timeSinceLastData,
        lastDataTime: lastDataTime
    });
});

// Veri kaynağını değiştir (SADECE ADMIN)
router.post('/api/source/switch', requireAdmin, (req, res) => {
    const { source } = req.body;
    const result = dataSource.switchDataSource(source);
    res.json(result);
});

router.get('/api/source/config', requireAuth, (req, res) => {
    res.json({
        currentSource: dataSource.getDataSource()
    });
});

// Supercapacitor kontrolü (SADECE ADMIN)
router.get('/capacitor', requireAdmin, (req, res) => {
    const { turn } = req.query;

    if (turn === '1') {
        state.supercapacitor = true;
        return res.status(200).json(1);
    } else if (turn === '0') {
        state.supercapacitor = false;
        return res.status(200).json(0);
    }
    // Sadece turn parametresi yoksa mevcut durumu döndür
    return res.status(200).json(state.supercapacitor ? 1 : 0);
});

module.exports = { router, dataRouter };
