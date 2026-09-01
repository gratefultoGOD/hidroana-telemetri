const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const config = require('../src/config');
const { getDailyFileName } = require('../src/utils/helpers');
const { parseUrbanHttpQuery, validateUrbanHttpQuery, buildUrbanHttpQuery } = require('../src/services/urbanPayload');
const { URBAN_FILE_SUFFIX, resolveUrbanDailyFileName, combineUrbanCsvContents } = require('../src/utils/urbanCsv');

const ROOT = path.resolve(__dirname, '..');
const quietConsole = { log() {}, error() {} };
const noop = () => {};
const LEGACY_FIELDS = 'h,gsmspeed,x,y,gs,fv,fa,fw,fet,fit,T_tank_C,bv,bc,bw,bwh,max_temperature,soc,ke,ischarging,charge_voltage,charge_current,charge_time,mv,mc,mw,enable,fwd_rev,rpm,throttle,controller_temperature,controller_speed,error_code,errorcode1,errorcode2,errorcode3'.split(',');
const PROTO_FIELDS = 'h,x,y,gs,fv,fa,fw,fet,fit,bv,bc,bw,bwh,t1,t2,t3,soc,ke,jv,jc,jw,jwh,mt,watt,ppm,gx,gy,gz,ax,ay,az,flow,totalflow,gsmspeed,pitch,roll,yaw,driver_pot,direksiyon_angle'.split(',');

// Bağımlılıkları yalnızca bu test örneğinde değiştir: gerçek MQTT, ayarlar ve kayıtlar açılmaz.
function loadModule(relativePath, stubs = {}, globals = {}, suffix = '') {
    const filename = path.join(ROOT, relativePath);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const source = fs.readFileSync(filename, 'utf8') + suffix;
    const factory = new Function('require', 'module', 'exports', '__filename', '__dirname', ...Object.keys(globals), source);
    factory(name => Object.hasOwn(stubs, name) ? stubs[name] : localRequire(name), module, module.exports,
        filename, path.dirname(filename), ...Object.values(globals));
    return module.exports;
}

function makeState() {
    return { urbanDataCounter: 0, latestUrbanTelemetryData: null, urbanConnectionStatus: {}, activeVehicle: 'urban' };
}

function makePipeline(overrides = {}) {
    return loadModule('src/services/dataPipeline.js', {
        '../state': makeState(),
        './telemetryStore': {},
        './urbanTelemetryStore': { checkDayRollover: noop, updateRunningAverages: noop, enqueueData: noop },
        './testMode': { recordTestData: noop, testMode: { active: false } },
        './tubitak': { recordTubitakData: noop },
        './flow': { findBestFlowMatch: () => null },
        './sse': { broadcastToClients: noop, broadcastToUrbanClients: noop },
        ...overrides,
    }, { console: quietConsole });
}

function sampleData() {
    return {
        ...Object.fromEntries(config.URBAN_DATA_FIELDS.map((field, index) => [field, String(index + 1)])),
        gsmspeed: '45.6', gs: '23', fv: '38.74', fa: '10.25', fw: '397.09',
        eysv: '52.21', eysc: '7.58', eysw: '395.75', oran: '65.25', flow: '12.50',
        bwh: '123.45', max_temperature: '41.5', ischarging: '1', charge_time: '01:20:00',
        enable: '1', fwd_rev: '2',
    };
}

function temporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'urban-telemetry-test-'));
    t.after(() => {
        const absolute = path.resolve(directory);
        assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
        assert.ok(path.basename(absolute).startsWith('urban-telemetry-test-'));
        fs.rmSync(absolute, { recursive: true, force: true });
    });
    return directory;
}

function csvRows(csv) {
    const [header, ...lines] = csv.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
    const headers = header.split(';');
    return { headers, rows: lines.map(line => Object.fromEntries(line.split(';').map((value, index) => [headers[index], value]))) };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function makeTestRecorder(directory, vehicle = 'urban', fileSystem = fs) {
    return loadModule('src/services/testMode.js', {
        '../config': { ...config, TEST_DIR: directory, FLUSH_THRESHOLD: 100 },
        '../state': makeState(),
        './systemSettings': { getActiveVehicle: () => vehicle },
        fs: fileSystem,
    }, { console: quietConsole });
}

async function createTestApi(t, directory, recorder) {
    const allow = (req, res, next) => next();
    const router = loadModule('src/routes/test.js', {
        '../config': { ...config, TEST_DIR: directory },
        '../services/testMode': recorder,
        '../middleware/auth': { requireAuth: allow, requireAdmin: allow },
    }, { console: quietConsole });
    const app = express();
    app.use(router);
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('Urban 40 alan kullanır; oran sonrasındaki flow toplamdır ve Proto 39 alanı korunur', () => {
    assert.equal(config.URBAN_DATA_FIELDS.length, 40);
    assert.equal(config.URBAN_DATA_FIELDS.at(-1), 'errorcode3');
    assert.equal(config.URBAN_DATA_FIELDS.includes('total_flow'), false);
    assert.deepEqual(config.URBAN_LEGACY_41_DATA_FIELDS, [...config.URBAN_DATA_FIELDS, 'total_flow']);
    assert.deepEqual(config.URBAN_LEGACY_DATA_FIELDS, LEGACY_FIELDS);
    assert.deepEqual(config.URBAN_DATA_FIELDS.slice(5, 13), ['fv', 'fa', 'fw', 'eysv', 'eysc', 'eysw', 'oran', 'flow']);
    assert.deepEqual(config.DATA_FIELDS, PROTO_FIELDS);
    assert.deepEqual(config.CSV_HEADERS, ['date', 'time', ...PROTO_FIELDS, 'realInstantFlow', 'realTotalFlow']);
    assert.deepEqual(config.TEST_CSV_HEADERS, ['test_time', ...config.CSV_HEADERS]);
    assert.deepEqual(config.URBAN_CSV_HEADERS.slice(0, 4), ['date', 'time', 'interval_ms', 'h']);
    assert.equal(config.URBAN_CSV_HEADERS.at(-1), 'errorcode3');
    assert.equal(config.URBAN_CSV_HEADERS.includes('total_flow'), false);
    assert.equal(config.URBAN_TEST_CSV_HEADERS.includes('total_flow'), false);
    assert.equal(config.URBAN_NUMERIC_FIELDS.includes('total_flow'), false);
    assert.deepEqual(config.URBAN_CSV_HEADERS, ['date', 'time', 'interval_ms', ...config.URBAN_DATA_FIELDS]);
    assert.equal(config.URBAN_TEST_CSV_HEADERS[config.URBAN_TEST_CSV_HEADERS.indexOf('time') + 1], 'interval_ms');
});

test('HTTP kısa adları MQTT ile aynı 40 değeri üretir; toplam flow alanında taşınır', () => {
    const data = sampleData();
    const query = buildUrbanHttpQuery(data, 'test-key');
    assert.equal(query.size, 41);
    assert.equal(query.get('flow'), '12.50');
    assert.equal(query.has('total_flow'), false);
    assert.equal(query.get('gs'), '45.6');
    assert.equal(query.get('gq'), '23');
    assert.equal(query.get('fc'), '10.25');
    assert.equal(query.get('ct'), '01:20:00');
    assert.match(query.toString(), /ct=01%3A20%3A00/);
    for (const [field, shortName] of Object.entries(config.URBAN_HTTP_FIELD_NAMES)) {
        assert.equal(query.get(shortName), data[field]);
        if (field !== 'gs') assert.equal(query.has(field), false);
    }
    const fromHttp = parseUrbanHttpQuery(Object.fromEntries(query));
    const fromMqtt = makePipeline().parseUrbanStarSeparatedData('01_' + config.URBAN_DATA_FIELDS.map(field => data[field]).join('*'));
    assert.deepEqual(fromHttp, data);
    assert.deepEqual(fromHttp, fromMqtt);
});

test('Urban HTTP yalnızca eksiksiz ve tipleri geçerli 40 alanı kabul eder', () => {
    const complete = buildUrbanHttpQuery(sampleData(), 'test-key');
    assert.deepEqual(validateUrbanHttpQuery(Object.fromEntries(complete)), {
        valid: true,
        data: sampleData(),
        errors: [],
    });

    for (const field of config.URBAN_DATA_FIELDS) {
        const query = new URLSearchParams(complete);
        query.delete(config.URBAN_HTTP_FIELD_NAMES[field] || field);
        const result = validateUrbanHttpQuery(Object.fromEntries(query));
        assert.equal(result.valid, false, `${field} eksikken istek reddedilmeli`);
        assert.ok(result.errors.some(error => error.field === field), field);
    }

    const invalidValues = [
        ['h', 'NaN'], ['fv', '38,5'], ['gq', '33'], ['isc', 'yes'],
        ['en', '2'], ['fr', '3'], ['rpm', '2400.5'], ['gaz', '45.5'], ['kec', '1.5'],
    ];
    for (const [name, value] of invalidValues) {
        const query = new URLSearchParams(complete);
        query.set(name, value);
        assert.equal(validateUrbanHttpQuery(Object.fromEntries(query)).valid, false, `${name}=${value}`);
    }

    const notCharging = buildUrbanHttpQuery({ ...sampleData(), ischarging: '0', charge_time: '' }, 'test-key');
    assert.equal(validateUrbanHttpQuery(Object.fromEntries(notCharging)).valid, true);
    const duplicate = Object.fromEntries(complete);
    duplicate.h = ['45', '46'];
    assert.equal(validateUrbanHttpQuery(duplicate).valid, false);
    assert.equal(validateUrbanHttpQuery({ ...Object.fromEntries(complete), total_flow: '99' }).valid, false);
});

test('HTTP eski uzun adları, sıfır değerleri ve metin URL kodlamasını korur', () => {
    const data = { ...sampleData(), charge_time: '1 saat 20 dk + kalan süre', ischarging: '0' };
    assert.deepEqual(parseUrbanHttpQuery(data), data);
    assert.deepEqual(parseUrbanHttpQuery(Object.fromEntries(buildUrbanHttpQuery(data, 'test-key'))), data);
    const zero = parseUrbanHttpQuery({ gs: '0', gq: '0', fc: '0', isc: '0', en: '0', fr: '0' });
    for (const field of ['gsmspeed', 'gs', 'fa', 'ischarging', 'enable', 'fwd_rev']) assert.equal(zero[field], '0');
    assert.equal(parseUrbanHttpQuery({ gs: '45.6' }).gs, null);
    assert.equal(parseUrbanHttpQuery({ gq: '23' }).gsmspeed, null);
    assert.equal(parseUrbanHttpQuery({ flow: '0' }).flow, '0');
    assert.equal(parseUrbanHttpQuery({}).flow, null);
    assert.equal(Object.hasOwn(parseUrbanHttpQuery({}), 'total_flow'), false);
});

test('Eski MQTT paketlerinde motor/şarj/hata sütunları kaymaz; eksik EYS boş kalır', () => {
    const data = { ...sampleData(), ischarging: 'not_charging', charge_time: '', total_flow: '25.50' };
    const pipeline = makePipeline();
    for (const prefix of ['', '01_']) {
        for (const fields of [LEGACY_FIELDS, config.URBAN_LEGACY_41_DATA_FIELDS, config.URBAN_DATA_FIELDS]) {
            for (const suffix of ['', '*']) {
                const parsed = pipeline.parseUrbanStarSeparatedData(prefix + fields.map(field => data[field]).join('*') + suffix);
                for (const field of fields) {
                    if (field === 'total_flow') continue;
                    const expected = field === 'flow' && fields === config.URBAN_LEGACY_41_DATA_FIELDS ? data.total_flow : data[field];
                    assert.equal(parsed[field], expected, field);
                }
                if (fields === LEGACY_FIELDS) for (const field of ['eysv', 'eysc', 'eysw', 'oran', 'flow']) assert.equal(parsed[field], null);
                assert.equal(Object.hasOwn(parsed, 'total_flow'), false);
            }
        }
    }
    assert.throws(() => pipeline.parseUrbanStarSeparatedData('01_1*2*3'), /paket uzunluğu/);
    const proto = pipeline.parseStarSeparatedData('01_' + PROTO_FIELDS.map((_, i) => i).join('*'));
    PROTO_FIELDS.forEach((field, i) => assert.equal(proto[field], String(i)));
});

test('Eski HTTP ve 41 alanlı MQTT toplamı flow adıyla okunur; sıfır korunur', () => {
    const pipeline = makePipeline();
    for (const total of ['12.50', '0', '999.1234']) {
        const oldData = { ...sampleData(), flow: '1.75', total_flow: total };
        const fromHttp = parseUrbanHttpQuery(oldData);
        const fromMqtt = pipeline.parseUrbanStarSeparatedData('01_' + config.URBAN_LEGACY_41_DATA_FIELDS.map(field => oldData[field]).join('*'));
        assert.deepEqual(fromHttp, fromMqtt);
        assert.equal(fromHttp.flow, total);
        assert.equal(Object.hasOwn(fromHttp, 'total_flow'), false);
        const newQuery = buildUrbanHttpQuery(oldData, 'test-key');
        assert.equal(newQuery.get('flow'), total);
        assert.equal(newQuery.has('total_flow'), false);
    }
    assert.equal(parseUrbanHttpQuery({ flow: '1.75', total_flow: '' }).flow, '');
    assert.equal(parseUrbanHttpQuery({ flow: '1.75', total_flow: null }).flow, null);
});

test('Paket aralığı ms ölçülür; flow toplamı aynen korunur, biriktirilmez veya hesaplanmaz', () => {
    const state = makeState();
    const records = [];
    const pipeline = makePipeline({
        '../state': state,
        './sse': { broadcastToUrbanClients: data => records.push(data) },
    });
    pipeline.processIncomingUrbanData({ ...sampleData(), flow: '999.1234' }, 10000);
    pipeline.processIncomingUrbanData({ ...sampleData(), flow: '999.1234' }, 11250);
    pipeline.processIncomingUrbanData({ ...sampleData(), flow: 0 }, 11250);
    const withoutFlow = sampleData();
    delete withoutFlow.flow;
    pipeline.processIncomingUrbanData(withoutFlow, 12500);
    assert.deepEqual(records.map(row => row.interval_ms), [null, 1250, 0, 1250]);
    assert.deepEqual(records.map(row => row.receivedAt), [10000, 11250, 11250, 12500]);
    assert.deepEqual(records.map(row => row.flow), ['999.1234', '999.1234', 0, null]);
    assert.ok(records.every(row => !Object.hasOwn(row, 'total_flow')));
    pipeline.processIncomingUrbanData({ ...sampleData(), flow: '1.75', total_flow: '20.50' }, 13000);
    assert.equal(records.at(-1).flow, '20.50');
    assert.equal(Object.hasOwn(records.at(-1), 'total_flow'), false);
});

test('Farklı şemalı günlük CSV yeniden yazılmaz; uyumlu sürüm bulunur', t => {
    const directory = temporaryDirectory(t);
    const base = '28-08-2026_urban_verileri.csv';
    fs.writeFileSync(path.join(directory, base), '\uFEFFdate;time;h\r\n2026-08-28;12:00:00;10\r\n');
    const v2 = resolveUrbanDailyFileName(directory, base, config.URBAN_CSV_HEADERS);
    assert.equal(v2, '28-08-2026_v2_urban_verileri.csv');
    fs.writeFileSync(path.join(directory, v2), '\uFEFF' + config.URBAN_CSV_HEADERS.join(';') + '\r\n');
    assert.equal(resolveUrbanDailyFileName(directory, base, config.URBAN_CSV_HEADERS), v2);
    assert.equal(resolveUrbanDailyFileName(directory, base, [...config.URBAN_CSV_HEADERS, 'future']), '28-08-2026_v3_urban_verileri.csv');
    assert.match(fs.readFileSync(path.join(directory, base), 'utf8'), /12:00:00;10/);
});

test('Eski ve yeni CSV birleştirmesi değerleri sütun adına göre hizalar', () => {
    const legacy = '\uFEFFdate;time;h;fv;fa;mv;t1\r\n2026-08-27;12:00:00;40;39.5;10.1;48;42\r\n';
    const oldTotals = 'date;time;interval_ms;h;eysv;oran;flow;total_flow\n2026-08-28;12:00:01;1000;45;52.21;65.25;1.75;12.50\n';
    const modern = 'date;time;interval_ms;h;eysv;oran;flow\n2026-08-28;12:00:02;1000;46;53.21;66.25;13.75\n';
    const { headers, rows } = csvRows(combineUrbanCsvContents([legacy, oldTotals, modern], config.URBAN_CSV_HEADERS));
    assert.equal(headers[2], 'interval_ms');
    assert.equal(rows[0].fv, '39.5');
    assert.equal(rows[0].mv, '48');
    assert.equal(rows[0].t1, '42');
    assert.equal(rows[0].eysv, '');
    assert.equal(rows[0].interval_ms, '');
    assert.equal(rows[1].interval_ms, '1000');
    assert.equal(rows[1].eysv, '52.21');
    assert.equal(rows[1].fv, '');
    assert.equal(rows[0].flow, '');
    assert.equal(rows[1].flow, '12.50');
    assert.equal(rows[2].flow, '13.75');
    assert.equal(headers.includes('total_flow'), false);
    assert.equal(combineUrbanCsvContents([legacy], config.URBAN_CSV_HEADERS, false).startsWith('\uFEFF'), false);
});

test('Eski toplam CSV sütunu boşsa anlık flow kullanılmaz; sıfır toplam korunur', () => {
    const csv = 'date;time;flow;total_flow\n2026-08-28;12:00:00;1.75;0\n2026-08-28;12:00:01;1.80;\n';
    const { headers, rows } = csvRows(combineUrbanCsvContents([csv], config.URBAN_CSV_HEADERS));
    assert.deepEqual(rows.map(row => row.flow), ['0', '']);
    assert.equal(headers.includes('total_flow'), false);
});

test('Toplu XLSX dışa aktarımında eski ve yeni toplamlar tek flow sütununda kalır', () => {
    const { csvToXlsxBuffer } = require('../src/utils/xlsx');
    const XLSX = require('xlsx');
    const oldCsv = 'date;time;oran;flow;total_flow\n2026-08-28;12:00:00;65;1.75;12.50\n';
    const newCsv = 'date;time;oran;flow\n2026-08-29;12:00:00;66;13.75\n';
    const csv = combineUrbanCsvContents([oldCsv, newCsv], config.URBAN_CSV_HEADERS, false);
    const buffer = csvToXlsxBuffer(csv, 'Urban');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const [headers, ...rows] = XLSX.utils.sheet_to_json(workbook.Sheets.Urban, { header: 1, defval: '' });
    assert.equal(headers.includes('total_flow'), false);
    assert.equal(headers.filter(header => header === 'flow').length, 1);
    assert.deepEqual(rows.map(row => row[headers.indexOf('flow')]), [12.5, 13.75]);
});

test('Gerçek Urban günlük/test kayıtları yeni alanları yazar; TÜBİTAK altı sütunlu kalır', async t => {
    const directory = temporaryDirectory(t);
    const state = makeState();
    const localConfig = { ...config, URBAN_DATA_DIR: directory, TEST_DIR: directory, TUBITAK_DIR: directory,
        FLUSH_THRESHOLD: 100, TUBITAK_FLUSH_THRESHOLD: 100 };
    const store = loadModule('src/services/urbanTelemetryStore.js', { '../config': localConfig, '../state': state });
    const recorder = loadModule('src/services/testMode.js', { '../config': localConfig, '../state': state,
        './systemSettings': { getActiveVehicle: () => 'urban' } });
    const tubitak = loadModule('src/services/tubitak.js', { '../config': localConfig, '../state': state }, { console: quietConsole });
    const started = recorder.startTest();
    const now = recorder.testMode.startTime;
    const oldName = getDailyFileName(new Date(now), URBAN_FILE_SUFFIX);
    const oldContent = ['date', 'time', 'interval_ms', ...config.URBAN_LEGACY_41_DATA_FIELDS].join(';') + '\n';
    fs.writeFileSync(path.join(directory, oldName), oldContent);
    store.invalidateFileCache();
    const pipeline = makePipeline({ '../state': state, './urbanTelemetryStore': store, './testMode': recorder, './tubitak': tubitak });
    pipeline.processIncomingUrbanData(parseUrbanHttpQuery(Object.fromEntries(buildUrbanHttpQuery(sampleData(), 'test-key'))), now);
    const mqttData = pipeline.parseUrbanStarSeparatedData('01_' + config.URBAN_DATA_FIELDS.map(field => sampleData()[field]).join('*'));
    pipeline.processIncomingUrbanData(mqttData, now + 1250);
    await Promise.all([store.flushDataToFile(), recorder.flushTestDataToFile(), tubitak.flushTubitakData(true)]);
    assert.equal(fs.readFileSync(path.join(directory, oldName), 'utf8'), oldContent);
    assert.match(store.getTodayFileName(), /_v2_urban_verileri\.csv$/);
    const daily = csvRows(fs.readFileSync(path.join(directory, store.getTodayFileName()), 'utf8'));
    const recorded = csvRows(fs.readFileSync(path.join(directory, started.testName), 'utf8'));
    assert.deepEqual(daily.headers, config.URBAN_CSV_HEADERS);
    assert.deepEqual(recorded.headers, config.URBAN_TEST_CSV_HEADERS);
    for (const csv of [daily, recorded]) {
        assert.equal(csv.rows.length, 2);
        assert.equal(csv.rows[0].interval_ms, '');
        assert.equal(csv.rows[1].interval_ms, '1250');
        for (const field of config.URBAN_DATA_FIELDS) assert.equal(csv.rows[1][field], sampleData()[field], field);
        assert.equal(csv.rows[1].flow, '12.50');
        assert.equal(csv.headers.includes('total_flow'), false);
    }
    // Gerçek kaydı Test Oynat'ın kendi ayrıştırıcısından geçir: tüm 40 alan korunmalı.
    const playerHtml = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8');
    const parserSource = playerHtml.slice(playerHtml.indexOf('function parseCSV('), playerHtml.indexOf('// Parse "HH:MM:SS.mmm"'));
    const normalizeSource = playerHtml.slice(playerHtml.indexOf('function normalizeUrbanRows('), playerHtml.indexOf('const chartDefs ='));
    const readPlayback = new Function('csv', `${parserSource}\n${normalizeSource}\nreturn normalizeUrbanRows(parseCSV(csv));`);
    const playback = readPlayback(fs.readFileSync(path.join(directory, started.testName), 'utf8'));
    assert.equal(playback.length, 2);
    assert.equal(playback[1].interval_ms, 1250);
    assert.equal(Object.hasOwn(playback[1], 'total_flow'), false);
    for (const field of config.URBAN_DATA_FIELDS) {
        const expected = field === 'charge_time' ? sampleData()[field] : Number(sampleData()[field]);
        assert.equal(playback[1][field], expected, `Test Oynat: ${field}`);
    }
    const official = csvRows(fs.readFileSync(path.join(directory, tubitak.tubitakSession.fileName), 'utf8'));
    assert.equal(official.headers.length, 6);
    assert.equal(official.rows[1].T_bat_C, sampleData().max_temperature);
    assert.equal(official.rows[1].T_tank_C, sampleData().T_tank_C);
    assert.equal(official.rows[1].zaman_ms, '1250');
    assert.equal(recorder.detectTestVehicle(recorded.headers, 'renamed.csv'), 'urban');
    assert.equal(recorder.detectTestVehicle(config.TEST_CSV_HEADERS, 'renamed.csv'), 'proto');
});

for (const vehicle of ['urban', 'proto']) {
    for (const scenario of ['bekleyen veri', 'devam eden yazma', 'devam eden yazma ve son veriler']) {
        test(`Test durdurma ${vehicle}: ${scenario} tamamlanmadan bitmez`, { timeout: 10000 }, async t => {
            const directory = temporaryDirectory(t);
            const gate = deferred();
            const entered = deferred();
            const firstWritten = deferred();
            const delayedFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
                entered.resolve();
                await gate.promise;
                try {
                    return await fs.promises.appendFile(...args);
                } finally {
                    firstWritten.resolve();
                }
            } } };
            const recorder = makeTestRecorder(directory, vehicle, delayedFs);
            const started = recorder.startTest();
            let flushing;
            let stopping;
            try {
                recorder.recordTestData({ ...sampleData(), h: '10' }, new Date());
                const expectedSpeeds = ['10'];
                if (scenario !== 'bekleyen veri') {
                    flushing = recorder.flushTestDataToFile();
                    await entered.promise;
                }
                if (scenario === 'devam eden yazma ve son veriler') {
                    recorder.recordTestData({ ...sampleData(), h: '11' }, new Date());
                    recorder.recordTestData({ ...sampleData(), h: '12' }, new Date());
                    expectedSpeeds.push('11', '12');
                }
                let completed = false;
                stopping = Promise.resolve(recorder.stopTest()).then(result => { completed = true; return result; });
                await entered.promise;
                await new Promise(setImmediate);
                assert.equal(completed, false, 'Durdurma, diske yazma bitmeden başarı dönmemeli');
                assert.equal(recorder.testMode.active, true, 'Önceki kayıt yazılırken yeni test başlatılmamalı');
                assert.equal(recorder.testMode.testName, started.testName);
                // Eşzamanlı ikinci durdurma aynı sonucu almalı; durdurmadan sonraki veri eklenmemeli.
                const secondStop = recorder.stopTest();
                recorder.recordTestData({ ...sampleData(), h: '999' }, new Date());
                gate.resolve();
                const result = await stopping;
                assert.deepEqual(await secondStop, result);
                const recorded = csvRows(fs.readFileSync(path.join(directory, started.testName), 'utf8'));
                assert.deepEqual(recorded.headers, vehicle === 'urban' ? config.URBAN_TEST_CSV_HEADERS : config.TEST_CSV_HEADERS);
                assert.deepEqual(recorded.rows.map(row => row.h), expectedSpeeds);
                assert.equal(result.dataCount, expectedSpeeds.length);
                assert.equal(result.testName, started.testName);
                assert.equal(result.vehicle, vehicle);
                assert.equal(recorder.testMode.active, false);
                assert.equal(recorder.testMode.testName, null);
                assert.equal(recorder.testMode.pendingTestData.length, 0);
            } finally {
                gate.resolve();
                await Promise.all([flushing, stopping, firstWritten.promise]);
            }
        });
    }
}

test('Test durdurmada yazma hatası bekleyen satırları korur; tekrar durdurma aynı dosyaya yazar', async t => {
    const directory = temporaryDirectory(t);
    let shouldFail = true;
    const failingFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
        if (shouldFail) throw new Error('Test amaçlı disk hatası');
        return fs.promises.appendFile(...args);
    } } };
    const recorder = makeTestRecorder(directory, 'urban', failingFs);
    const started = recorder.startTest();
    recorder.recordTestData({ ...sampleData(), h: '10' }, new Date());
    await recorder.flushTestDataToFile();
    recorder.recordTestData({ ...sampleData(), h: '11' }, new Date());
    await assert.rejects(async () => recorder.stopTest(), /kaydedilemedi/);
    assert.equal(recorder.testMode.active, true);
    assert.equal(recorder.testMode.testName, started.testName);
    assert.deepEqual(recorder.testMode.pendingTestData.map(row => row.h), ['10', '11']);
    shouldFail = false;
    const result = await recorder.stopTest();
    assert.equal(result.dataCount, 2);
    assert.equal(result.testName, started.testName);
    const recorded = csvRows(fs.readFileSync(path.join(directory, result.testName), 'utf8'));
    assert.deepEqual(recorded.rows.map(row => row.h), ['10', '11']);
    assert.equal(recorder.testMode.active, false);
});

test('Test durdurma API yazmayı bekler, eşzamanlı yeni testi engeller ve son satırları oynatmaya hazır döner', { timeout: 10000 }, async t => {
    const directory = temporaryDirectory(t);
    const gate = deferred();
    const entered = deferred();
    const stopEntered = deferred();
    const delayedFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
        entered.resolve();
        await gate.promise;
        return fs.promises.appendFile(...args);
    } } };
    const recorder = makeTestRecorder(directory, 'urban', delayedFs);
    const originalStop = recorder.stopTest;
    recorder.stopTest = () => {
        const operation = originalStop();
        stopEntered.resolve();
        return operation;
    };
    const baseUrl = await createTestApi(t, directory, recorder);
    const started = recorder.startTest();
    recorder.recordTestData({ ...sampleData(), h: '10' }, new Date());
    const flushing = recorder.flushTestDataToFile();
    let request;
    try {
        await entered.promise;
        recorder.recordTestData({ ...sampleData(), h: '11' }, new Date());
        let replied = false;
        request = fetch(`${baseUrl}/api/test/stop`, { method: 'POST' }).then(response => { replied = true; return response; });
        await stopEntered.promise;
        const blockedStart = await fetch(`${baseUrl}/api/test/start`, { method: 'POST' });
        assert.equal(blockedStart.status, 400);
        assert.equal((await blockedStart.json()).testName, started.testName);
        assert.equal(replied, false, 'HTTP başarı yanıtı son satır yazılmadan gönderilmemeli');
        gate.resolve();
        const response = await request;
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.success, true);
        assert.equal(result.testName, started.testName);
        assert.equal(result.dataCount, 2);
        assert.equal(result.vehicle, 'urban');
        assert.ok(Number.isFinite(result.durationMs));
        const contentResponse = await fetch(`${baseUrl}/api/test/content/${encodeURIComponent(result.testName)}`);
        assert.equal(contentResponse.status, 200);
        const recorded = csvRows(await contentResponse.text());
        assert.deepEqual(recorded.rows.map(row => row.h), ['10', '11']);
    } finally {
        gate.resolve();
        await Promise.all([flushing, request]);
    }
});

test('Test durdurma API disk hatasında başarı dönmez; tekrar deneyince kayıt eksiksiz kapanır', { timeout: 10000 }, async t => {
    const directory = temporaryDirectory(t);
    let shouldFail = true;
    const failingFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
        if (shouldFail) throw new Error('Test amaçlı disk hatası');
        return fs.promises.appendFile(...args);
    } } };
    const recorder = makeTestRecorder(directory, 'urban', failingFs);
    const baseUrl = await createTestApi(t, directory, recorder);
    const started = recorder.startTest();
    recorder.recordTestData({ ...sampleData(), h: '10' }, new Date());
    const failed = await fetch(`${baseUrl}/api/test/stop`, { method: 'POST' });
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /kaydedilemedi/);
    assert.equal(recorder.testMode.active, true);
    assert.equal(recorder.testMode.testName, started.testName);
    assert.equal(recorder.testMode.pendingTestData.length, 1);
    shouldFail = false;
    const retry = await fetch(`${baseUrl}/api/test/stop`, { method: 'POST' });
    assert.equal(retry.status, 200);
    const result = await retry.json();
    assert.equal(result.dataCount, 1);
    assert.equal(result.testName, started.testName);
    assert.equal(recorder.testMode.active, false);
});

test('HTTP publisher kısa adlar ve EYS/Oran/Flow ile eksiksiz paket oluşturur', () => {
    const publisher = loadModule('urban-http-publisher.js', { './src/config': { ...config, API_KEY: 'test-key' } }, { process: { env: {} } });
    const data = publisher.buildTelemetryData();
    const url = publisher.createRequestUrl(data);
    assert.equal(url.searchParams.get('key'), 'test-key');
    assert.deepEqual(parseUrbanHttpQuery(Object.fromEntries(url.searchParams)), data);
    for (const field of ['eysv', 'eysc', 'eysw', 'oran', 'flow']) assert.ok(Number.isFinite(Number(data[field])));
    assert.equal(Object.keys(data).length, 40);
    assert.equal(url.searchParams.get('flow'), '12.55');
    assert.equal(url.searchParams.has('total_flow'), false);
    assert.equal(Object.hasOwn(data, 'total_flow'), false);
    assert.equal(publisher.buildTelemetryData().flow, '12.60');
    assert.equal(url.searchParams.has('charge_time'), false);
    assert.equal(url.searchParams.has('ct'), true);
    assert.equal(url.searchParams.get('s'), '0');
    assert.equal(publisher.createRequestUrl(data, { startNewFile: true }).searchParams.get('s'), '1');
});

test('MQTT publisher gerçek brokera bağlanmadan 40 alanlı toplam flow stringi üretir', () => {
    let message;
    const client = { on: noop, publish(topic, value) { message = value; } };
    const publisher = loadModule('urban-publisher.js', { mqtt: { connect: () => client } },
        { process: { env: {}, on: noop }, console: quietConsole }, '\nmodule.exports = { sendTelemetryData };');
    publisher.sendTelemetryData();
    const parsed = makePipeline().parseUrbanStarSeparatedData(message);
    assert.equal(message.slice(3).split('*').length, 40);
    for (const field of ['eysv', 'eysc', 'eysw', 'oran', 'flow']) assert.ok(Number.isFinite(Number(parsed[field])));
    assert.equal(parsed.flow, '12.55');
    assert.equal(Object.hasOwn(parsed, 'total_flow'), false);
    publisher.sendTelemetryData();
    assert.equal(makePipeline().parseUrbanStarSeparatedData(message).flow, '12.60');
    assert.equal(parsed.ischarging, 'not_charging');
    assert.equal(parsed.error_code, '0');
});

test('Gerçek /data isteği Urban kısa adlarını işler; Proto adları değişmez', async t => {
    let vehicle = 'urban';
    let resolvePacket;
    const processed = [];
    const accept = (data, receivedAt, options) => { processed.push({ data, receivedAt, options }); resolvePacket(); };
    const { dataRouter } = loadModule('src/routes/source.js', {
        '../config': { ...config, API_KEY: 'test-key' },
        '../state': { supercapacitor: false },
        '../services/dataSource': { getDataSource: () => 'HTTP' },
        '../services/dataPipeline': { processIncomingUrbanData: accept, processIncomingData: accept },
        '../services/systemSettings': { getActiveVehicle: () => vehicle },
    }, { console: quietConsole });
    const app = express();
    app.use(dataRouter);
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/data`;
    const incomplete = buildUrbanHttpQuery(sampleData(), 'test-key');
    incomplete.delete('eysv');
    const rejected = await fetch(`${url}?${incomplete}`);
    assert.equal(rejected.status, 400);
    assert.equal(await rejected.text(), 'INVALID_DATA');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(processed.length, 0);
    const received = new Promise(resolve => { resolvePacket = resolve; });
    const startedAt = Date.now();
    const response = await fetch(`${url}?${buildUrbanHttpQuery(sampleData(), 'test-key')}`);
    assert.equal(response.status, 200);
    await response.text();
    await received;
    assert.deepEqual(processed[0].data, sampleData());
    assert.ok(processed[0].receivedAt >= startedAt);
    assert.deepEqual(processed[0].options, { source: 'HTTP', startNewFile: false });
    vehicle = 'proto';
    const protoReceived = new Promise(resolve => { resolvePacket = resolve; });
    const protoResponse = await fetch(`${url}?key=test-key&gs=22&gsmspeed=45.6&fa=7.5&fc=999&s=1`);
    await protoResponse.text();
    await protoReceived;
    assert.equal(processed[1].data.gs, '22');
    assert.equal(processed[1].data.gsmspeed, '45.6');
    assert.equal(processed[1].data.fa, '7.5');
    assert.equal(Object.hasOwn(processed[1].data, 'eysv'), false);
    assert.equal(processed[1].options, undefined);
});

function makeTubitakRecorder(directory, fileSystem = fs) {
    return loadModule('src/services/tubitak.js', {
        '../config': { ...config, TUBITAK_DIR: directory, TUBITAK_FLUSH_THRESHOLD: 100 },
        '../state': makeState(),
        fs: fileSystem,
    }, { console: quietConsole });
}

function readTubitakRows(directory, fileName) {
    return csvRows(fs.readFileSync(path.join(directory, fileName), 'utf8')).rows;
}

test('TÜBİTAK HTTP s=1 paketini yeni dosyanın ilk satırına hemen yazar; s=0 devam eder', async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    const start = new Date(2026, 7, 28, 12, 0, 0, 123);
    const data = { ...sampleData(), h: '10' };
    const firstWrite = recorder.recordTubitakData(data, start, { source: 'HTTP', startNewFile: true });
    const firstName = recorder.tubitakSession.fileName;
    // Await/sonraki paket olmadan ilk veri dosyadadır; yalnızca başlık açılmaz.
    assert.deepEqual(readTubitakRows(directory, firstName), [{
        zaman_ms: '0', hiz_kmh: '10', T_bat_C: data.max_temperature,
        T_tank_C: data.T_tank_C, V_bat_C: data.bv, kalan_enerji_Wh: data.ke,
    }]);
    await firstWrite;
    await recorder.recordTubitakData({ ...data, h: '11' }, new Date(start.getTime() + 1250), { source: 'HTTP' });
    // 60 saniyelik eski otomatik ayırma HTTP s=0 için uygulanmaz.
    await recorder.recordTubitakData({ ...data, h: '12' }, new Date(start.getTime() + 125000), { source: 'HTTP' });
    assert.equal(recorder.tubitakSession.fileName, firstName);
    assert.deepEqual(readTubitakRows(directory, firstName).map(row => [row.zaman_ms, row.hiz_kmh]),
        [['0', '10'], ['1250', '11'], ['125000', '12']]);
    await recorder.recordTubitakData({ ...data, h: '20' }, new Date(start.getTime() + 126000), { source: 'HTTP', startNewFile: true });
    const secondName = recorder.tubitakSession.fileName;
    assert.notEqual(secondName, firstName);
    assert.deepEqual(readTubitakRows(directory, secondName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '20']]);
    assert.equal(readTubitakRows(directory, firstName).length, 3);
});

test('TÜBİTAK yeni kayıtta V_bat_C başlığını kullanır; eski V_bat_V dosyasına dokunmaz', async t => {
    const directory = temporaryDirectory(t);
    const oldName = 'tubitak_28-08-2026_12-00-00.csv';
    const oldContent = '\uFEFFzaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_V;kalan_enerji_Wh\n0;10;40;30;52.4;39.5\n';
    fs.writeFileSync(path.join(directory, oldName), oldContent);
    const recorder = makeTubitakRecorder(directory);
    await recorder.recordTubitakData({ ...sampleData(), bv: '53.25' }, new Date(2026, 7, 28, 12, 0, 1), { source: 'HTTP' });
    assert.notEqual(recorder.tubitakSession.fileName, oldName);
    assert.equal(fs.readFileSync(path.join(directory, oldName), 'utf8'), oldContent);
    const recorded = csvRows(fs.readFileSync(path.join(directory, recorder.tubitakSession.fileName), 'utf8'));
    assert.deepEqual(recorded.headers, ['zaman_ms', 'hiz_kmh', 'T_bat_C', 'T_tank_C', 'V_bat_C', 'kalan_enerji_Wh']);
    assert.equal(recorded.rows[0].V_bat_C, '53.25');
    assert.equal(recorded.rows[0].zaman_ms, '0');
});

test('TÜBİTAK aynı milisaniyede her s=1 için ayrı dosya açar; önceki dosyayı ezmez', async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    const now = new Date(2026, 7, 28, 12, 0, 0, 456);
    const names = [];
    for (const h of ['10', '20', '30']) {
        await recorder.recordTubitakData({ ...sampleData(), h }, now, { source: 'HTTP', startNewFile: true });
        names.push(recorder.tubitakSession.fileName);
    }
    assert.equal(new Set(names).size, 3);
    assert.deepEqual(names.map(name => readTubitakRows(directory, name).map(row => row.hiz_kmh)), [['10'], ['20'], ['30']]);
    assert.ok(recorder.getTubitakFiles().every(file => file.date === '28-08-2026' && file.time === '12:00:00'));
});

test('TÜBİTAK s=1 eski dosyanın eşik altında bekleyen satırlarını kaybetmez', async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    const start = Date.now();
    await recorder.recordTubitakData({ ...sampleData(), h: '10' }, new Date(start));
    const oldName = recorder.tubitakSession.fileName;
    await recorder.recordTubitakData({ ...sampleData(), h: '11' }, new Date(start + 100));
    assert.equal(recorder.tubitakSession.pending.length, 1);
    await recorder.recordTubitakData({ ...sampleData(), h: '20' }, new Date(start + 200), { source: 'HTTP', startNewFile: true });
    const newName = recorder.tubitakSession.fileName;
    assert.deepEqual(readTubitakRows(directory, oldName).map(row => row.hiz_kmh), ['10', '11']);
    assert.deepEqual(readTubitakRows(directory, newName).map(row => row.hiz_kmh), ['20']);
    assert.equal(recorder.tubitakSession.pending.length, 0);
});

test('TÜBİTAK eski dosya yazılırken s=1/s=0 gelirse satırlar doğru dosyalarda kalır', { timeout: 5000 }, async t => {
    const directory = temporaryDirectory(t);
    let releaseWrite;
    let enteredWrite;
    const gate = new Promise(resolve => { releaseWrite = resolve; });
    const entered = new Promise(resolve => { enteredWrite = resolve; });
    const delayedFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
        enteredWrite();
        await gate;
        return fs.promises.appendFile(...args);
    } } };
    const recorder = makeTubitakRecorder(directory, delayedFs);
    const start = Date.now();
    await recorder.recordTubitakData({ ...sampleData(), h: '10' }, new Date(start), { source: 'HTTP', startNewFile: true });
    const oldName = recorder.tubitakSession.fileName;
    const oldWrite = recorder.recordTubitakData({ ...sampleData(), h: '11' }, new Date(start + 10), { source: 'HTTP' });
    await entered;
    const newWrite = recorder.recordTubitakData({ ...sampleData(), h: '20' }, new Date(start + 20), { source: 'HTTP', startNewFile: true });
    const newName = recorder.tubitakSession.fileName;
    const nextWrite = recorder.recordTubitakData({ ...sampleData(), h: '21' }, new Date(start + 30), { source: 'HTTP' });
    releaseWrite();
    await Promise.all([oldWrite, newWrite, nextWrite, recorder.flushTubitakData(true)]);
    assert.deepEqual(readTubitakRows(directory, oldName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '10'], ['10', '11']]);
    assert.deepEqual(readTubitakRows(directory, newName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '20'], ['10', '21']]);
    assert.equal(recorder.tubitakSession.pending.length, 0);
});

test('TÜBİTAK yazma hatası sonrası satırı özgün dosyasına tekrar yazar', async t => {
    const directory = temporaryDirectory(t);
    let shouldFail = true;
    const failingFs = { ...fs, promises: { ...fs.promises, appendFile: async (...args) => {
        if (shouldFail) {
            shouldFail = false;
            throw new Error('Test amaçlı geçici yazma hatası');
        }
        return fs.promises.appendFile(...args);
    } } };
    const recorder = makeTubitakRecorder(directory, failingFs);
    const start = Date.now();
    await recorder.recordTubitakData({ ...sampleData(), h: '10' }, new Date(start), { source: 'HTTP', startNewFile: true });
    const oldName = recorder.tubitakSession.fileName;
    assert.equal(await recorder.recordTubitakData({ ...sampleData(), h: '11' }, new Date(start + 10), { source: 'HTTP' }), false);
    assert.equal(recorder.tubitakSession.pending[0].fileName, oldName);
    await recorder.recordTubitakData({ ...sampleData(), h: '20' }, new Date(start + 20), { source: 'HTTP', startNewFile: true });
    assert.deepEqual(readTubitakRows(directory, oldName).map(row => row.hiz_kmh), ['10', '11']);
    assert.deepEqual(readTubitakRows(directory, recorder.tubitakSession.fileName).map(row => row.hiz_kmh), ['20']);
});

test('TÜBİTAK HTTP s=0 ilk dosyayı oluşturur; yeniden başlatmada son açılan dosyayı sürdürür', async t => {
    const directory = temporaryDirectory(t);
    const firstProcess = makeTubitakRecorder(directory);
    const start = new Date(2026, 7, 28, 12, 0, 0, 123).getTime();
    await firstProcess.recordTubitakData({ ...sampleData(), h: '10' }, new Date(start), { source: 'HTTP' });
    const oldName = firstProcess.tubitakSession.fileName;
    await firstProcess.recordTubitakData({ ...sampleData(), h: '20' }, new Date(start + 1000), { source: 'HTTP', startNewFile: true });
    const latestName = firstProcess.tubitakSession.fileName;
    // Eski kaydın mtime'ı daha yeni olsa bile s=0 son AÇILAN dosyayı seçer.
    fs.utimesSync(path.join(directory, oldName), new Date(), new Date(Date.now() + 60000));
    const restarted = makeTubitakRecorder(directory);
    await restarted.recordTubitakData({ ...sampleData(), h: '21' }, new Date(start + 125000), { source: 'HTTP' });
    assert.equal(restarted.tubitakSession.fileName, latestName);
    assert.deepEqual(readTubitakRows(directory, latestName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '20'], ['124000', '21']]);
    assert.equal(restarted.getTubitakFiles().length, 2);
    // MQTT'nin ilk paket/yeni oturum davranışı değişmez.
    const mqttProcess = makeTubitakRecorder(directory);
    await mqttProcess.recordTubitakData(sampleData(), new Date(start + 126000));
    assert.notEqual(mqttProcess.tubitakSession.fileName, latestName);
    const mqttFirst = mqttProcess.tubitakSession.fileName;
    await mqttProcess.recordTubitakData(sampleData(), new Date(start + 126000 + config.TUBITAK_GAP_MS + 1));
    assert.notEqual(mqttProcess.tubitakSession.fileName, mqttFirst);
});

test('TÜBİTAK s=0 eski dosya adını destekler ve geçersiz başlıklı dosyaya eklemez', async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    const legacyName = 'tubitak_28-08-2026_12-00-00.csv';
    const firstRow = recorder.buildTubitakRow({ ...sampleData(), h: '10' }, 0);
    fs.writeFileSync(path.join(directory, legacyName), '\uFEFF' + config.TUBITAK_HEADERS + '\n' + firstRow + '\n');
    fs.writeFileSync(path.join(directory, 'tubitak_28-08-2026_12-00-01_000.csv'), 'yanlis;baslik\n');
    await recorder.recordTubitakData({ ...sampleData(), h: '11' }, new Date(2026, 7, 28, 12, 0, 1, 250), { source: 'HTTP' });
    assert.equal(recorder.tubitakSession.fileName, legacyName);
    assert.deepEqual(readTubitakRows(directory, legacyName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '10'], ['1250', '11']]);
});

test('Urban HTTP s=1 → s=0 → s=1 isteği gerçek pipeline ve TÜBİTAK dosyalarında doğrulanır', { timeout: 10000 }, async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    let delivered = noop;
    const pipeline = makePipeline({ './tubitak': recorder, './sse': { broadcastToUrbanClients: () => delivered() } });
    const { dataRouter } = loadModule('src/routes/source.js', {
        '../config': { ...config, API_KEY: 'test-key' },
        '../state': { supercapacitor: false },
        '../services/dataSource': { getDataSource: () => 'HTTP' },
        '../services/dataPipeline': pipeline,
        '../services/systemSettings': { getActiveVehicle: () => 'urban' },
    }, { console: quietConsole });
    const app = express();
    app.use(dataRouter);
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    async function send(s, h, key = 'test-key') {
        const query = buildUrbanHttpQuery({ ...sampleData(), h }, key);
        if (s !== undefined) query.set('s', s);
        const processed = new Promise(resolve => { delivered = resolve; });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/data?${query}`);
        const body = await response.text();
        if (response.ok) await processed;
        await recorder.flushTubitakData(true);
        return { status: response.status, body };
    }
    assert.equal((await send('1', '10')).status, 200);
    const firstName = recorder.tubitakSession.fileName;
    assert.deepEqual(readTubitakRows(directory, firstName).map(row => [row.zaman_ms, row.hiz_kmh]), [['0', '10']]);
    await send('0', '11');
    assert.equal(recorder.tubitakSession.fileName, firstName);
    await send('1', '20');
    const secondName = recorder.tubitakSession.fileName;
    assert.notEqual(firstName, secondName);
    await send(undefined, '21');
    assert.deepEqual(readTubitakRows(directory, firstName).map(row => row.hiz_kmh), ['10', '11']);
    assert.deepEqual(readTubitakRows(directory, secondName).map(row => row.hiz_kmh), ['20', '21']);
    assert.equal(readTubitakRows(directory, secondName)[0].zaman_ms, '0');
    assert.deepEqual(await send('2', '99'), { status: 400, body: 'INVALID_S' });
    assert.equal((await send('1', '99', 'wrong-key')).status, 401);
    assert.equal(recorder.getTubitakFiles().length, 2);
    assert.equal(readTubitakRows(directory, secondName).length, 2);
    assert.equal(config.URBAN_DATA_FIELDS.includes('s'), false);
    assert.equal(config.URBAN_CSV_HEADERS.includes('s'), false);
});
