const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const frontendRequire = createRequire(path.join(ROOT, 'telemetriV2/package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const importLocal = relativePath => import(pathToFileURL(path.join(ROOT, relativePath)).href);

// JSX'yi projedeki derleyiciyle dönüştürüp gerçek React çıktısını kontrol et.
// CSS/import bağlantıları testte enjekte edilir; tarayıcı veya sunucu açılmaz.
async function loadComponent(name, dependencies = {}) {
    const filename = path.join(ROOT, 'telemetriV2/src/components', `${name}.jsx`);
    const { transformSync } = await import(pathToFileURL(frontendRequire.resolve('rolldown/utils')).href);
    const source = fs.readFileSync(filename, 'utf8').replace(/^import .+$/gm, '').replace('export default ', '');
    const result = transformSync(filename, source, { jsx: { runtime: 'classic' } });
    assert.equal(result.errors.length, 0);
    return new Function('React', 'useMemo', ...Object.keys(dependencies), `${result.code}\nreturn ${name};`)(
        React, React.useMemo, ...Object.values(dependencies));
}

test('Urban arayüz ayrıştırması FC/EYS, Oran/Flow, Wh ve maksimum sıcaklığı ayırır', async () => {
    const { parseUrbanPayload } = await importLocal('telemetriV2/src/hooks/useTelemetryData.js');
    const parsed = parseUrbanPayload({
        fv: '38.74', fa: '10.25', fw: '397.09', eysv: '52.21', eysc: '7.58', eysw: '395.75',
        oran: '65.25', flow: '12.50', bwh: '123.45', max_temperature: '41.5', T_tank_C: '30.2',
        gsmspeed: '45.6', gs: '23', error_code: '6', errorcode1: '32',
    });
    assert.deepEqual(parsed.fuelCell, { voltage: 38.74, current: 10.25, power: 397.09 });
    assert.deepEqual(parsed.eys, { voltage: 52.21, current: 7.58, power: 395.75 });
    assert.deepEqual(parsed.fuelCellMetrics, { oran: 65.25, flow: 12.5 });
    assert.equal(parsed.batteryMeta.wh, 123.45);
    assert.deepEqual(parsed.temps, { max: 41.5, tank: 30.2 });
    assert.equal(parsed.gpsSpeed, 45.6);
    assert.equal(parsed.signalStrength, 23);
    assert.equal(parsed.kelly.errorCode, 6);
    assert.deepEqual(parsed.vehicleControlErrorCodes, [32, 0, 0]);
    assert.equal(Object.hasOwn(parsed, 'total_flow'), false);
    const old = parseUrbanPayload({ fv: '38.74', t1: '30', t2: '42', t3: '35' });
    assert.equal(old.temps.max, 42);
    assert.equal(old.eys.voltage, null);
    assert.equal(old.fuelCellMetrics.flow, null);
});

test('Urban ekranı eski total_flow değerini yeni flow olarak gösterir; toplamı tekrar biriktirmez', async () => {
    const { parseUrbanPayload } = await importLocal('telemetriV2/src/hooks/useTelemetryData.js');
    assert.equal(parseUrbanPayload({ flow: '1.75', total_flow: '12.50' }).fuelCellMetrics.flow, 12.5);
    assert.equal(parseUrbanPayload({ flow: '1.75', total_flow: '0' }).fuelCellMetrics.flow, 0);
    assert.equal(parseUrbanPayload({ flow: '1.75', total_flow: '' }).fuelCellMetrics.flow, null);
    assert.equal(parseUrbanPayload({ flow: '0' }).fuelCellMetrics.flow, 0);
    assert.equal(parseUrbanPayload({ flow: '12.50' }).fuelCellMetrics.flow, 12.5);
    const app = fs.readFileSync(path.join(ROOT, 'telemetriV2/src/App.jsx'), 'utf8');
    assert.match(app, /label: 'Toplam Flow', value: data\.fuelCellMetrics\.flow/);
});

test('EYS değişince kadran ibresi/SVG değişmez; Fuel Cell değişince değişir', async () => {
    const GaugeDial = await loadComponent('GaugeDial');
    const props = { label: 'Voltaj', value: 38.74, min: 0, max: 50, unit: 'V', paired: true, readoutDecimals: 2 };
    const render = changes => renderToStaticMarkup(React.createElement(GaugeDial, { ...props, ...changes }));
    const first = render({ secondaryValue: 52.21 });
    const second = render({ secondaryValue: 20 });
    const third = render({ value: 10, secondaryValue: 52.21 });
    const svg = html => html.match(/<svg[\s\S]*?<\/svg>/)[0];
    assert.equal(svg(first), svg(second));
    assert.notEqual(svg(first), svg(third));
    assert.match(first.replace(/<[^>]+>/g, ''), /38\.74V \/ 52\.21V/);
    const missing = render({ secondaryValue: null });
    assert.match(missing.replace(/<[^>]+>/g, ''), /38\.74V \/ --V/);
});

test('FC/EYS değerleri normal kadran yazı boyutunu kullanır; açıklama daha aşağıda kalır', () => {
    const css = fs.readFileSync(path.join(ROOT, 'telemetriV2/src/components/GaugeDial.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const pairedReadouts = rules.filter(([, selector]) =>
        selector.includes('.gauge--paired') && /\.gauge__(value|unit)\b/.test(selector));
    assert.ok(pairedReadouts.length > 0);
    for (const [, , declarations] of pairedReadouts) {
        assert.doesNotMatch(declarations, /font(?:-size)?\s*:/, 'Çift değerler ortak yazı boyutunu ezmemeli');
        assert.doesNotMatch(declarations, /white-space\s*:\s*nowrap/, 'Dar ekranda çift değerler taşmamalı');
    }
    assert.match(css, /\.gauge__value\s*\{[^}]*font-size:\s*clamp\(0\.8rem, 1\.95vh, 1\.3rem\)/);
    assert.match(css, /\.gauge--paired \.gauge__label\s*\{[^}]*margin-top:\s*0\.5rem/);
});

test('Urban kartında FC/EYS üç çift değer ve Oran/Flow alt satırı bulunur', async () => {
    const GaugeDial = await loadComponent('GaugeDial');
    const SystemPanel = await loadComponent('SystemPanel', { GaugeDial });
    const { RANGES } = await importLocal('telemetriV2/src/hooks/useTelemetryData.js');
    const html = renderToStaticMarkup(React.createElement(SystemPanel, {
        title: 'Yakıt Hücresi', data: { voltage: 38.74, current: 10.25, power: 397.09 },
        comparisonData: { voltage: 52.21, current: 7.58, power: 395.75 },
        ranges: RANGES.fuelCell, stats: { minVoltage: 30, maxCurrent: 15 },
        footerMetrics: [{ label: 'Oran', value: 65.25, unit: '%', decimals: 2 }, { label: 'Toplam Flow', value: 12.5, decimals: 2 }],
    }));
    const text = html.replace(/<[^>]+>/g, '');
    assert.equal((html.match(/gauge--paired/g) || []).length, 3);
    assert.match(text, /38\.74V \/ 52\.21V/);
    assert.match(text, /10\.25A \/ 7\.58A/);
    assert.match(text, /397\.09W \/ 395\.75W/);
    assert.match(text, /Min Voltaj30\.0V.*Maks Akım15\.0A.*Oran65\.25%.*Toplam Flow12\.50/);
    assert.match(html, /system-panel__footer-metrics/);
    assert.doesNotMatch(html, /interval_ms|total_flow/);
});

test('State tek batarya maksimum sıcaklığı, tank ve ayrı AKS kodlarını gösterir', async () => {
    const { TEMP_RANGE } = await importLocal('telemetriV2/src/hooks/useTelemetryData.js');
    const StatusPanel = await loadComponent('StatusPanel', { TEMP_RANGE });
    const html = renderToStaticMarkup(React.createElement(StatusPanel, {
        temps: { max: 41.5, tank: 30.2 }, vehicleControlErrorCodes: [11, 22, 33],
    }));
    const text = html.replace(/<[^>]+>/g, '');
    assert.match(text, /Batarya Maks. Sıcaklık41\.5°C/);
    assert.match(text, /Tank Sıcaklığı30\.2°C/);
    assert.match(text, /AKS Hata Kodları11 \/ 22 \/ 33/);
    assert.doesNotMatch(text, /T1|T2|T3/);
});

test('Kelly kodu hâlâ doğrudan eşleştirilir, bit maskesine çevrilmez', async () => {
    const { getKellyError } = await importLocal('telemetriV2/src/utils/kellyErrors.js');
    assert.equal(getKellyError(32).name, 'Internal volts fault');
    assert.equal(getKellyError(32).code, 'ERR5');
    assert.match(getKellyError(6).name, /Tanımsız/);
});

test('Test oynat Urban FC/EYS grafiklerini ekler, Proto görünümünü geri yükler', () => {
    const html = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8');
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        assert.doesNotThrow(() => new Function(script));
    }
    const definitionSource = html.slice(html.indexOf('const chartDefs ='), html.indexOf('function makeChartConfig('));
    const { chartDefs, configureChartDefsForVehicle } = new Function(`${definitionSource}\nreturn { chartDefs, configureChartDefsForVehicle };`)();
    const byId = id => chartDefs.find(def => def.id === id);
    configureChartDefsForVehicle(true);
    assert.deepEqual(byId('chartFv').fields, ['fv', 'eysv']);
    assert.deepEqual(byId('chartFa').fields, ['fa', 'eysc']);
    assert.deepEqual(byId('chartFw').fields, ['fw', 'eysw']);
    assert.deepEqual(byId('chartJv').fields, ['mv']);
    assert.deepEqual(byId('chartBatTemp').fields, ['max_temperature']);
    assert.equal(byId('chartUrbanFlow').vehicle, 'urban');
    assert.equal(byId('chartUrbanFlow').label, 'Toplam Flow');
    assert.deepEqual(byId('chartUrbanFlow').fields, ['flow']);
    assert.equal(byId('chartOran').vehicle, 'urban');
    configureChartDefsForVehicle(false);
    assert.deepEqual(byId('chartFv').fields, ['fv']);
    assert.equal(byId('chartFv').dual, false);
    assert.deepEqual(byId('chartJv').fields, ['jv']);
    assert.deepEqual(byId('chartBatTemp').fields, ['t1', 't2', 't3']);
    assert.ok(chartDefs.every(def => !def.fields.includes('interval_ms') && !def.fields.includes('total_flow')));
    const parseSource = html.slice(html.indexOf('function parseCSV('), html.indexOf('// Parse "HH:MM:SS.mmm"'));
    const parseCSV = new Function(`${parseSource}\nreturn parseCSV;`)();
    const rows = parseCSV('test_time;date;time;interval_ms;fv;eysv;flow\n00:00:01;2026-08-28;12:00:01;1250;38.74;52.21;12.50\n');
    assert.equal(rows[0].eysv, 52.21);
    assert.equal(rows[0].fv, 38.74);
    assert.equal(rows[0].interval_ms, 1250);
    assert.equal(rows[0].flow, 12.5);
    assert.equal(Object.hasOwn(rows[0], 'total_flow'), false);
    const normalizeSource = html.slice(html.indexOf('function normalizeUrbanRows('), html.indexOf('const chartDefs ='));
    const normalizeUrbanRows = new Function(`${normalizeSource}\nreturn normalizeUrbanRows;`)();
    assert.equal(normalizeUrbanRows(rows)[0].flow, 12.5);
    const oldRows = parseCSV('flow;total_flow\n1.75;12.50\n1.80;0\n1.85;\n');
    const normalized = normalizeUrbanRows(oldRows);
    assert.deepEqual(normalized.map(row => row.flow), [12.5, 0, '']);
    assert.ok(normalized.every(row => !Object.hasOwn(row, 'total_flow')));
    assert.equal(oldRows[0].flow, 1.75, 'Orijinal eski kayıt değiştirilmez');
    assert.equal(oldRows[0].total_flow, 12.5);
    assert.deepEqual(parseCSV('flow;totalflow\n1.75;12.50\n'), [{ flow: 1.75, totalflow: 12.5 }], 'Proto alanları değişmez');
});
