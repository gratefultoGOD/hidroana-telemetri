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
const { parseTestCsv } = require('../src/services/testArchive');

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
        './urbanStableMode': { configureProcessor: noop, observeRealUrbanHttpData: noop },
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

function makeTestRecorder(directory, vehicle = 'urban', fileSystem = fs, globals = {}) {
    return loadModule('src/services/testMode.js', {
        '../config': { ...config, TEST_DIR: directory, FLUSH_THRESHOLD: 100 },
        '../state': makeState(),
        './systemSettings': { getActiveVehicle: () => vehicle },
        fs: fileSystem,
    }, { console: quietConsole, ...globals });
}

async function createTestApi(t, directory, recorder) {
    const router = loadModule('src/routes/test.js', {
        '../config': { ...config, TEST_DIR: directory },
        '../services/testMode': recorder,
    }, { console: quietConsole });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { userId: 'test-user', userRole: req.headers['x-test-role'] || 'admin' };
        next();
    });
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

test('Urban HTTP yalnızca 40 alanın tamamının bulunmasını zorunlu tutar; içeriği doğrulamaz', () => {
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
        assert.equal(validateUrbanHttpQuery(Object.fromEntries(query)).valid, true, `${name}=${value}`);
    }

    for (const field of config.URBAN_DATA_FIELDS) {
        const query = new URLSearchParams(complete);
        query.set(config.URBAN_HTTP_FIELD_NAMES[field] || field, '');
        assert.equal(validateUrbanHttpQuery(Object.fromEntries(query)).valid, true, `${field} boş olabilir`);
    }

    const withObsoleteExtra = validateUrbanHttpQuery({ ...Object.fromEntries(complete), total_flow: '99' });
    assert.equal(withObsoleteExtra.valid, true);
    assert.equal(withObsoleteExtra.data.flow, sampleData().flow);

    const onlyObsoleteFlow = Object.fromEntries(complete);
    delete onlyObsoleteFlow.flow;
    onlyObsoleteFlow.total_flow = '99';
    assert.equal(validateUrbanHttpQuery(onlyObsoleteFlow).valid, false);
});

test('Urban stabil modu 1500 ms kesintide gerçekçi tam paket üretir; gerçek veri dönünce bekler', () => {
    const stableState = { activeVehicle: 'urban', connectionStatus: { source: 'HTTP' } };
    const generated = [];
    const service = loadModule('src/services/urbanStableMode.js', {
        '../config': config,
        '../state': stableState,
    }, { console: quietConsole });
    service.configureProcessor((data, receivedAt, options) => generated.push({ data, receivedAt, options }));

    const real = { ...sampleData(), h: '48.0', gsmspeed: '47.5', rpm: '2400', throttle: '45' };
    service.observeRealUrbanHttpData(real, 1000);
    service.setStableMode(true, { runTimer: false });

    assert.equal(service.checkStableMode(2499), false);
    assert.equal(service.checkStableMode(2500), true);
    assert.equal(generated.length, 1);
    assert.equal(generated[0].receivedAt, 2500);
    assert.deepEqual(generated[0].options, { source: 'HTTP', startNewFile: false, synthetic: true });
    assert.ok(config.URBAN_DATA_FIELDS.every(field => Object.hasOwn(generated[0].data, field)));
    const variableFields = new Set(['bw', 'max_temperature', 'T_tank_C']);
    for (const field of config.URBAN_DATA_FIELDS) {
        if (!variableFields.has(field)) assert.equal(generated[0].data[field], real[field], `${field} sabit kalmalı`);
    }
    assert.notEqual(generated[0].data.bw, real.bw);
    assert.equal(service.getStableModeStatus(2500).generating, true);

    service.observeRealUrbanHttpData({ ...real, h: '49.0' }, 2700);
    assert.equal(service.getStableModeStatus(2700).generating, false);
    assert.equal(service.checkStableMode(4199), false);
    service.setStableMode(false, { runTimer: false });
    assert.equal(service.checkStableMode(6000), false);
});

test('Stabil sahte paketi günlük, test, TÜBİTAK ve SSE dahil aynı Urban pipeline hattından geçer', () => {
    const pipelineState = makeState();
    pipelineState.connectionStatus = { source: 'HTTP' };
    const dailyRows = [];
    const testRows = [];
    const tubitakRows = [];
    const sseRows = [];
    const stableService = loadModule('src/services/urbanStableMode.js', {
        '../config': config,
        '../state': pipelineState,
    }, { console: quietConsole });
    const pipeline = loadModule('src/services/dataPipeline.js', {
        '../state': pipelineState,
        './telemetryStore': {},
        './urbanTelemetryStore': {
            checkDayRollover: noop,
            updateRunningAverages: noop,
            enqueueData: data => dailyRows.push(data),
        },
        './testMode': { recordTestData: data => testRows.push(data), testMode: { active: true } },
        './tubitak': { recordTubitakData: (data, now, options) => tubitakRows.push({ data, now, options }) },
        './flow': { findBestFlowMatch: () => null },
        './sse': { broadcastToClients: noop, broadcastToUrbanClients: data => sseRows.push(data) },
        './urbanStableMode': stableService,
    }, { console: quietConsole });

    pipeline.processIncomingUrbanData({ ...sampleData(), h: '48.0' }, 1000, { source: 'HTTP', startNewFile: true });
    stableService.setStableMode(true, { runTimer: false });
    assert.equal(stableService.checkStableMode(2500), true);

    assert.equal(pipelineState.urbanDataCounter, 2);
    assert.equal(dailyRows.length, 2);
    assert.equal(testRows.length, 2);
    assert.equal(tubitakRows.length, 2);
    assert.equal(sseRows.length, 2);
    assert.deepEqual(tubitakRows[1].options, { source: 'HTTP', startNewFile: false });
    assert.equal(sseRows[1].interval_ms, 1500);
    assert.ok(config.URBAN_DATA_FIELDS.every(field => Object.hasOwn(sseRows[1], field)));
    stableService.setStableMode(false, { runTimer: false });
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
    assert.deepEqual(official.rows.map(row => row.hiz_kmh), [sampleData().controller_speed, sampleData().controller_speed]);
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

test('2027 test arşivi test ayrıntılarını ve duraklamaları CSV/Excel çıktısına taşır', async t => {
    const directory = temporaryDirectory(t);
    const startedAt = Date.parse('2026-11-21T22:05:06Z');
    let now = startedAt;
    class TestClock extends Date {
        constructor(value = now) { super(value); }
        static now() { return now; }
    }
    const recorder = makeTestRecorder(directory, 'proto', fs, { Date: TestClock });
    const baseUrl = await createTestApi(t, directory, recorder);
    const request = (route, method = 'GET', body, userRole = 'admin') => fetch(`${baseUrl}/api/test/${route}`, {
        method, headers: { 'Content-Type': 'application/json', 'x-test-role': userRole }, body: JSON.stringify(body)
    });
    const legacy = '\uFEFFtest_time;date;time;h\n00:00:00.010;2026-08-09;13:43:03.704;10\n';
    fs.writeFileSync(path.join(directory, 'onceki.csv'), legacy);
    fs.writeFileSync(path.join(directory, 'eski-bicim.csv'), 't:2025-08-09;s:13:43:03.704;h:10;mv:50\n');
    const details = {
        vehicle: 'urban', motor: '0124', powerSource: 'Hibrit', purpose: 'Motor sürücü testi', track: 'MF arkası',
        pilotName: "Öykü O'Connor.", vehicleWeightKg: '115.8', pilotWeightKg: '63.5', beforeNotes: 'İlk satır; "ölçüm"\nİkinci satır'
    };
    const rejected = await request('start', 'POST', { ...details, purpose: 'Farklı dişli oranları' });
    assert.equal(rejected.status, 400);
    const response = await request('start', 'POST', details);
    assert.equal(response.status, 200);
    const started = await response.json();
    assert.equal(started.testName, "2026-11-22 - Dorlion V2 - 0124 - Öykü O'Connor.csv");
    assert.equal(started.archiveYear, 2027);
    assert.equal(started.vehicle, 'urban');
    const entry = `${encodeURIComponent(started.testName)}?year=${started.archiveYear}`;
    assert.equal((await request(`download/${entry}`)).status, 409);

    recorder.recordTestData({ h: '9' }, new Date(startedAt + 1000), 'proto');
    recorder.recordTestData({ h: '10' }, new Date(startedAt + 3000), 'urban');
    now += 4000;
    const firstPause = await (await request('pause', 'POST')).json();
    const note = 'Lastik; basıncı "ölçüldü"\nTekrar kontrol';
    const saved = await request('pause-note', 'PATCH', { pausedAt: firstPause.pausedAt, note });
    assert.equal(saved.status, 200);
    assert.equal((await (await request('status')).json()).pauseNote, note);
    assert.equal(Object.hasOwn(await (await request('status', 'GET', undefined, 'user')).json(), 'pauseNote'), false);
    recorder.recordTestData({ h: '99' }, new Date(now + 1000), 'urban');
    now += 3000;
    assert.equal((await request('resume', 'POST')).status, 200);
    recorder.recordTestData({ h: '20' }, new Date(now + 2000), 'urban');
    now = startedAt + 12500;
    const secondPause = await (await request('pause', 'POST')).json();
    assert.equal((await request('pause-note', 'PATCH', { pausedAt: firstPause.pausedAt, note: 'Eski istek' })).status, 409);
    assert.equal((await request('pause-note', 'PATCH', { pausedAt: secondPause.pausedAt, note: 'Test burada bitti' })).status, 200);
    now += 10000;
    const result = await (await request('stop', 'POST')).json();
    assert.equal(result.durationMs, 9500);
    assert.equal(result.dataCount, 2);
    const afterNotes = 'Sonuç; düzenli\nİkinci satır';
    assert.equal((await request(`after-note/${entry}`, 'POST', { note: afterNotes })).status, 200);

    const { files: [file, previous, keyValue] } = await (await request('files')).json();
    assert.equal(file.year, 2027);
    assert.equal(file.date, '2026-11-22');
    assert.equal(file.time, '01:05:06');
    assert.equal(file.motor, details.motor);
    assert.equal(file.pilotName, details.pilotName);
    assert.equal(file.vehicleWeightKg, 115.8);
    assert.equal(file.pilotWeightKg, 63.5);
    assert.equal(file.beforeNotes, details.beforeNotes);
    assert.equal(file.afterNotes, afterNotes);
    assert.deepEqual(file.pauses.map(pause => [pause.durationMs, pause.note]), [[3000, note], [10000, 'Test burada bitti']]);
    assert.equal(previous.year, 2026);
    assert.equal(previous.archiveYear, null);
    assert.equal(keyValue.year, 2025);
    assert.equal(keyValue.dataCount, 1);
    assert.equal(keyValue.vehicle, 'urban');
    const { files: [viewerFile] } = await (await request('files', 'GET', undefined, 'user')).json();
    assert.equal(viewerFile.motor, details.motor);
    assert.equal(Object.hasOwn(viewerFile, 'pauses'), false);
    assert.equal((await request(`download/${entry}`, 'GET', undefined, 'user')).status, 403);

    const download = await request(`download/${entry}`);
    const csv = await download.text();
    assert.match(download.headers.get('content-disposition'), /O%27Connor/);
    assert.equal(csv.replace(/^\uFEFF/, ''), fs.readFileSync(path.join(directory, '2027', started.testName), 'utf8').replace(/^\uFEFF/, ''));
    const { events, telemetry, headers } = parseTestCsv(csv);
    assert.deepEqual(telemetry.map(row => row[headers.indexOf('h')]), ['10', '20']);
    assert.deepEqual(events.map(event => event.record_type), ['test_start', 'pause', 'pause', 'test_end', 'after_note']);
    assert.equal(events[1].pause_note, note);
    const playback = parseTestCsv(await (await request(`content/${entry}`, 'GET', undefined, 'user')).text());
    assert.equal(playback.telemetry.length, 2);
    assert.deepEqual(playback.headers, config.URBAN_TEST_CSV_HEADERS);
    assert.equal(playback.events.length, 0);
    assert.equal((await (await request('content/onceki.csv')).text()).replace(/^\uFEFF/, ''), legacy.slice(1));

    const xlsxResponse = await request(`download-xlsx/${entry}`);
    assert.equal(xlsxResponse.status, 200);
    const XLSX = require('xlsx');
    const workbook = XLSX.read(await xlsxResponse.arrayBuffer());
    const [xlsxHeaders, startRow, , pauseRow] = XLSX.utils.sheet_to_json(workbook.Sheets['Test Verisi'], { header: 1 });
    assert.equal(startRow[xlsxHeaders.indexOf('motor')], '0124');
    assert.equal(pauseRow[xlsxHeaders.indexOf('pause_note')], note);

    const again = await (await request('start', 'POST', details)).json();
    assert.match(again.testName, / - 2\.csv$/);
    assert.equal((await request('stop', 'POST')).status, 200);
    assert.equal((await request(`rename/${entry}`, 'PATCH', { newName: 'Yeni isim' })).status, 200);
    const { files: renamed } = await (await request('files')).json();
    assert.equal(renamed.find(record => record.fileName === 'Yeni isim.csv').afterNotes, afterNotes);
    assert.equal((await request('delete/Yeni%20isim.csv?year=2027', 'DELETE')).status, 200);
    assert.equal(fs.existsSync(path.join(directory, '2027', 'Yeni isim.csv')), false);
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

test('Gerçek /data isteği Urban kısa adlarını ve Proto MQTT alanlarının tamamını işler', async t => {
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

    const invalidContent = { ...sampleData(), h: 'NaN', fv: '', gs: '999', ischarging: 'beklenmeyen' };
    const invalidContentReceived = new Promise(resolve => { resolvePacket = resolve; });
    const accepted = await fetch(`${url}?${buildUrbanHttpQuery(invalidContent, 'test-key')}`);
    assert.equal(accepted.status, 200);
    await accepted.text();
    await invalidContentReceived;
    assert.deepEqual(processed[0].data, invalidContent);

    const received = new Promise(resolve => { resolvePacket = resolve; });
    const startedAt = Date.now();
    const response = await fetch(`${url}?${buildUrbanHttpQuery(sampleData(), 'test-key')}`);
    assert.equal(response.status, 200);
    await response.text();
    await received;
    assert.deepEqual(processed[1].data, sampleData());
    assert.ok(processed[1].receivedAt >= startedAt);
    assert.deepEqual(processed[1].options, { source: 'HTTP', startNewFile: false });
    vehicle = 'proto';
    const protoData = {
        ...Object.fromEntries(PROTO_FIELDS.map((field, index) => [field, String(index + 1)])),
        gs: '22', gsmspeed: '45.6', fa: '7.5', gp: '1', kz: '10000', id: 'proto-1',
        watt: '0', flow: '1.25', totalflow: '10.75', direksiyon_angle: '-2.5',
    };
    const protoQuery = new URLSearchParams({ ...protoData, key: 'test-key', fc: '999', eysv: '42', s: '1' });
    const protoReceived = new Promise(resolve => { resolvePacket = resolve; });
    const protoResponse = await fetch(`${url}?${protoQuery}`);
    assert.equal(protoResponse.status, 200);
    assert.equal(await protoResponse.text(), '');
    await protoReceived;
    assert.deepEqual(processed[2].data, protoData);
    assert.equal(processed[2].options, undefined);

    const sparseReceived = new Promise(resolve => { resolvePacket = resolve; });
    const sparseResponse = await fetch(`${url}?key=test-key&h=25&soc=78`);
    assert.equal(sparseResponse.status, 200);
    await sparseResponse.text();
    await sparseReceived;
    assert.equal(processed[3].data.h, '25');
    assert.equal(processed[3].data.soc, '78');
    assert.equal(processed[3].data.watt, null);
    assert.equal(processed[3].data.id, null);
});

test('GET /stablemode yalnızca endpoint ve konsol üzerinden açılır, kapanır ve durum döndürür', async t => {
    let enabled = false;
    const stableService = {
        observeRealUrbanHttpData: noop,
        setStableMode(value) { enabled = value; },
        getStableModeStatus() {
            return {
                enabled,
                generating: false,
                timeoutMs: 1500,
                generatedCount: 0,
                lastRealReceivedAt: null,
                lastRealAgeMs: null,
                syntheticIntervalMs: 1000,
            };
        },
    };
    const allow = (req, res, next) => next();
    const { router } = loadModule('src/routes/source.js', {
        '../config': { ...config, API_KEY: 'test-key' },
        '../state': { supercapacitor: false },
        '../services/dataSource': { getDataSource: () => 'HTTP' },
        '../services/dataPipeline': { processIncomingUrbanData: noop, processIncomingData: noop },
        '../services/urbanPayload': { validateUrbanHttpQuery: () => ({ valid: true, data: sampleData(), errors: [] }) },
        '../services/urbanStableMode': stableService,
        '../services/systemSettings': { getActiveVehicle: () => 'urban' },
        '../middleware/auth': { requireAuth: allow, requireAdmin: allow },
    }, { console: quietConsole });
    const app = express();
    app.use(router);
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/stablemode`;

    let response = await fetch(`${url}?turn=1`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).enabled, true);
    response = await fetch(url);
    assert.equal((await response.json()).enabled, true);
    response = await fetch(`${url}?turn=0`);
    assert.equal((await response.json()).enabled, false);
    response = await fetch(`${url}?turn=2`);
    assert.equal(response.status, 400);
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

test('TÜBİTAK hızı yalnızca Kelly controller_speed alanından gelir; sıfır ve ham değer korunur', t => {
    const recorder = makeTubitakRecorder(temporaryDirectory(t));
    for (const [value, expected] of [
        ['42.7', '42.7'], [0, '0'], ['0.0', '0.0'], ['invalid', 'invalid'], ['inf', 'inf'],
        ['', ''], [null, ''], [undefined, ''],
    ]) {
        const data = { ...sampleData(), h: '80.0', gsmspeed: '81.0', controller_speed: value };
        const before = { ...data };
        assert.deepEqual(recorder.buildTubitakRow(data, 1250).split(';'), [
            '1250', expected, data.max_temperature, data.T_tank_C, data.bv, data.ke,
        ]);
        assert.deepEqual(data, before);
    }
    const withoutKelly = { ...sampleData(), h: '80.0', gsmspeed: '81.0' };
    delete withoutKelly.controller_speed;
    assert.equal(recorder.buildTubitakRow(withoutKelly, 0).split(';')[1], '');
});

test('TÜBİTAK HTTP s=1 paketini yeni dosyanın ilk satırına hemen yazar; s=0 devam eder', async t => {
    const directory = temporaryDirectory(t);
    const recorder = makeTubitakRecorder(directory);
    const start = new Date(2026, 7, 28, 12, 0, 0, 123);
    const data = { ...sampleData(), controller_speed: '10' };
    const firstWrite = recorder.recordTubitakData(data, start, { source: 'HTTP', startNewFile: true });
    const firstName = recorder.tubitakSession.fileName;
    // Await/sonraki paket olmadan ilk veri dosyadadır; yalnızca başlık açılmaz.
    assert.deepEqual(readTubitakRows(directory, firstName), [{
        zaman_ms: '0', hiz_kmh: '10', T_bat_C: data.max_temperature,
        T_tank_C: data.T_tank_C, V_bat_C: data.bv, kalan_enerji_Wh: data.ke,
    }]);
    await firstWrite;
    await recorder.recordTubitakData({ ...data, controller_speed: '11' }, new Date(start.getTime() + 1250), { source: 'HTTP' });
    // 60 saniyelik eski otomatik ayırma HTTP s=0 için uygulanmaz.
    await recorder.recordTubitakData({ ...data, controller_speed: '12' }, new Date(start.getTime() + 125000), { source: 'HTTP' });
    assert.equal(recorder.tubitakSession.fileName, firstName);
    assert.deepEqual(readTubitakRows(directory, firstName).map(row => [row.zaman_ms, row.hiz_kmh]),
        [['0', '10'], ['1250', '11'], ['125000', '12']]);
    await recorder.recordTubitakData({ ...data, controller_speed: '20' }, new Date(start.getTime() + 126000), { source: 'HTTP', startNewFile: true });
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
    for (const controller_speed of ['10', '20', '30']) {
        await recorder.recordTubitakData({ ...sampleData(), controller_speed }, now, { source: 'HTTP', startNewFile: true });
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
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '10' }, new Date(start));
    const oldName = recorder.tubitakSession.fileName;
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '11' }, new Date(start + 100));
    assert.equal(recorder.tubitakSession.pending.length, 1);
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '20' }, new Date(start + 200), { source: 'HTTP', startNewFile: true });
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
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '10' }, new Date(start), { source: 'HTTP', startNewFile: true });
    const oldName = recorder.tubitakSession.fileName;
    const oldWrite = recorder.recordTubitakData({ ...sampleData(), controller_speed: '11' }, new Date(start + 10), { source: 'HTTP' });
    await entered;
    const newWrite = recorder.recordTubitakData({ ...sampleData(), controller_speed: '20' }, new Date(start + 20), { source: 'HTTP', startNewFile: true });
    const newName = recorder.tubitakSession.fileName;
    const nextWrite = recorder.recordTubitakData({ ...sampleData(), controller_speed: '21' }, new Date(start + 30), { source: 'HTTP' });
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
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '10' }, new Date(start), { source: 'HTTP', startNewFile: true });
    const oldName = recorder.tubitakSession.fileName;
    assert.equal(await recorder.recordTubitakData({ ...sampleData(), controller_speed: '11' }, new Date(start + 10), { source: 'HTTP' }), false);
    assert.equal(recorder.tubitakSession.pending[0].fileName, oldName);
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '20' }, new Date(start + 20), { source: 'HTTP', startNewFile: true });
    assert.deepEqual(readTubitakRows(directory, oldName).map(row => row.hiz_kmh), ['10', '11']);
    assert.deepEqual(readTubitakRows(directory, recorder.tubitakSession.fileName).map(row => row.hiz_kmh), ['20']);
});

test('TÜBİTAK HTTP s=0 ilk dosyayı oluşturur; yeniden başlatmada son açılan dosyayı sürdürür', async t => {
    const directory = temporaryDirectory(t);
    const firstProcess = makeTubitakRecorder(directory);
    const start = new Date(2026, 7, 28, 12, 0, 0, 123).getTime();
    await firstProcess.recordTubitakData({ ...sampleData(), controller_speed: '10' }, new Date(start), { source: 'HTTP' });
    const oldName = firstProcess.tubitakSession.fileName;
    await firstProcess.recordTubitakData({ ...sampleData(), controller_speed: '20' }, new Date(start + 1000), { source: 'HTTP', startNewFile: true });
    const latestName = firstProcess.tubitakSession.fileName;
    // Eski kaydın mtime'ı daha yeni olsa bile s=0 son AÇILAN dosyayı seçer.
    fs.utimesSync(path.join(directory, oldName), new Date(), new Date(Date.now() + 60000));
    const restarted = makeTubitakRecorder(directory);
    await restarted.recordTubitakData({ ...sampleData(), controller_speed: '21' }, new Date(start + 125000), { source: 'HTTP' });
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
    const firstRow = recorder.buildTubitakRow({ ...sampleData(), controller_speed: '10' }, 0);
    fs.writeFileSync(path.join(directory, legacyName), '\uFEFF' + config.TUBITAK_HEADERS + '\n' + firstRow + '\n');
    fs.writeFileSync(path.join(directory, 'tubitak_28-08-2026_12-00-01_000.csv'), 'yanlis;baslik\n');
    await recorder.recordTubitakData({ ...sampleData(), controller_speed: '11' }, new Date(2026, 7, 28, 12, 0, 1, 250), { source: 'HTTP' });
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
    async function send(s, controller_speed, key = 'test-key') {
        const query = buildUrbanHttpQuery({ ...sampleData(), controller_speed }, key);
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
