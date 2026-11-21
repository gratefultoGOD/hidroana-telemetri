const fs = require('fs');
const path = require('path');
const { csvRow, parseCsvRows } = require('../utils/csv');
const { isSafeFileName } = require('../utils/helpers');
const { VEHICLE_NAMES, testDateAndTime } = require('./testDetails');

const YEAR_FOLDER = /^[1-9]\d{3}$/;
const DETAIL_FIELDS = {
    motor: 'motor', powerSource: 'power_source', purpose: 'test_purpose', track: 'track',
    pilotName: 'pilot_name', vehicleWeightKg: 'vehicle_weight_kg', pilotWeightKg: 'pilot_weight_kg',
    beforeNotes: 'before_notes'
};
const TEST_EVENT_HEADERS = [
    'record_type', 'archive_year', 'vehicle_name', ...Object.values(DETAIL_FIELDS), 'after_notes',
    'event_started_at', 'event_ended_at', 'event_duration_ms', 'pause_note'
];
const TEST_TEXT_COLUMNS = ['motor', 'pilot_name', 'before_notes', 'after_notes', 'pause_note'];

function isTestFileName(fileName) {
    return isSafeFileName(fileName) && !/[<>:"|?*\x00-\x1f]/.test(fileName);
}

function testFilePath(root, fileName, archiveYear) {
    return path.join(root, archiveYear ? String(archiveYear) : '', fileName);
}

function availableTestName(directory, suggestedName) {
    const base = suggestedName.slice(0, -4);
    let fileName = suggestedName;
    for (let suffix = 2; fs.existsSync(path.join(directory, fileName)); suffix++) {
        fileName = `${base} - ${suffix}.csv`;
    }
    return fileName;
}

function testStartRecord(details, archiveYear, now) {
    return {
        record_type: 'test_start', archive_year: archiveYear, vehicle_name: VEHICLE_NAMES[details.vehicle],
        event_started_at: now.toISOString(),
        ...Object.fromEntries(Object.entries(DETAIL_FIELDS).map(([key, column]) => [column, details[key]]))
    };
}

async function listTestPaths(root) {
    async function list(directory, archiveYear) {
        let entries;
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
        const files = entries.filter(entry => entry.isFile() && isTestFileName(entry.name))
            .map(entry => ({ fileName: entry.name, archiveYear, filePath: path.join(directory, entry.name) }));
        if (archiveYear) return files;
        const folders = entries.filter(entry => entry.isDirectory() && YEAR_FOLDER.test(entry.name));
        const archived = await Promise.all(folders.map(folder => list(path.join(directory, folder.name), Number(folder.name))));
        return files.concat(archived.flat());
    }
    return list(root, null);
}

function detectTestVehicle(headers, fileName = '') {
    const urbanFields = ['T_tank_C', 'max_temperature', 'mv', 'mc', 'mw', 'ischarging', 'controller_speed', 'error_code'];
    if (urbanFields.some(header => headers.includes(header))) return 'urban';
    return fileName.startsWith('test_urban_') ? 'urban' : 'proto';
}

function parseTestCsv(content) {
    const [rawHeaders = [], ...rows] = parseCsvRows(content);
    const headers = rawHeaders.map(header => header.trim());
    const eventIndex = headers.indexOf('record_type');
    const telemetry = [];
    const events = [];
    for (const row of rows) {
        const type = row[eventIndex];
        if (!type || type === 'telemetry') telemetry.push(row);
        else events.push(Object.fromEntries(headers.slice(eventIndex).map((header, index) => [header, row[index + eventIndex]])));
    }
    return { headers, eventIndex, telemetry, events };
}

function testPlaybackCsv(content) {
    // Oynatıcı zaman çizelgesi sadece telemetri satırlarından oluşur.
    if (!content.split('\n', 1)[0].includes(';record_type;')) return content;
    const { headers, eventIndex, telemetry } = parseTestCsv(content);
    return '\uFEFF' + csvRow(headers.slice(0, eventIndex)) + telemetry.map(row => csvRow(row.slice(0, eventIndex))).join('');
}

function legacyDate(fileName, date, lastModified) {
    const value = `${date || ''} ${fileName}`;
    const iso = value.match(/(?:^|\D)(\d{4}-\d{2}-\d{2})(?!\d)/);
    if (iso) return iso[1];
    const local = value.match(/(?:^|\D)(\d{2})[.-](\d{2})[.-](\d{4})(?!\d)/);
    return local ? `${local[3]}-${local[2]}-${local[1]}` : testDateAndTime(lastModified).date;
}

async function readTestRecord({ filePath, fileName, archiveYear }, includeDetails) {
    const [stats, content] = await Promise.all([fs.promises.stat(filePath), fs.promises.readFile(filePath, 'utf8')]);
    const { headers, telemetry, events } = parseTestCsv(content);
    const start = events.find(event => event.record_type === 'test_start');
    const end = events.find(event => event.record_type === 'test_end');
    const startTime = start?.event_started_at || null;
    const endTime = end?.event_ended_at || null;
    const firstDate = headers.find(field => field.startsWith('t:'))?.slice(2).trim();
    const firstTime = headers.find(field => field.startsWith('s:'))?.slice(2).trim();
    const keyValueFormat = Boolean(firstDate && firstTime);
    const vehicleHeaders = keyValueFormat ? headers.map(field => field.split(':', 1)[0]) : headers;
    const vehicle = detectTestVehicle(vehicleHeaders, fileName);
    const dateTime = startTime ? testDateAndTime(new Date(startTime)) : {
        date: legacyDate(fileName, firstDate || telemetry[0]?.[headers.indexOf('date')]?.trim(), stats.mtime),
        time: firstTime || telemetry[0]?.[headers.indexOf('time')]?.trim() || ''
    };
    const record = {
        fileName, archiveYear, year: archiveYear ?? (Number(start?.archive_year) || Number(dateTime.date.slice(0, 4))),
        vehicle, vehicleName: start?.vehicle_name || VEHICLE_NAMES[vehicle], ...dateTime,
        motor: start?.motor, powerSource: start?.power_source, purpose: start?.test_purpose,
        track: start?.track, pilotName: start?.pilot_name,
        dataCount: telemetry.length + Number(keyValueFormat), fileSize: stats.size, lastModified: stats.mtime,
        startTime, endTime, durationMs: end ? Number(end.event_duration_ms) : null
    };
    if (includeDetails) {
        const lastNote = events.findLast(event => event.record_type === 'after_note');
        Object.assign(record, {
            vehicleWeightKg: start ? Number(start.vehicle_weight_kg) : null,
            pilotWeightKg: start ? Number(start.pilot_weight_kg) : null,
            beforeNotes: start?.before_notes || '',
            afterNotes: lastNote?.after_notes || '',
            pauses: events.filter(event => event.record_type === 'pause').map(event => ({
                startTime: event.event_started_at, endTime: event.event_ended_at,
                durationMs: Number(event.event_duration_ms), note: event.pause_note
            }))
        });
    }
    return record;
}

function appendTestAfterNote(filePath, note) {
    // Yalnızca başlığı oku. Not, aynı dosyaya ayrı bir olay satırı olarak yazılır.
    const descriptor = fs.openSync(filePath, 'r+');
    try {
        const buffer = Buffer.alloc(4096);
        const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        const headers = buffer.toString('utf8', 0, length).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split(';');
        if (!headers.includes('record_type') || !headers.includes('after_notes')) return false;
        const position = fs.fstatSync(descriptor).size;
        const event = { record_type: 'after_note', after_notes: note };
        const row = Buffer.from(csvRow(headers.map(header => event[header])));
        try {
            if (fs.writeSync(descriptor, row, 0, row.length, position) !== row.length) throw new Error('Eksik yazma');
        } catch (error) {
            fs.ftruncateSync(descriptor, position);
            throw error;
        }
        return true;
    } finally {
        fs.closeSync(descriptor);
    }
}

module.exports = {
    YEAR_FOLDER, TEST_EVENT_HEADERS, TEST_TEXT_COLUMNS, isTestFileName, testFilePath, availableTestName,
    testStartRecord, listTestPaths, detectTestVehicle, parseTestCsv, testPlaybackCsv, readTestRecord, appendTestAfterNote
};
