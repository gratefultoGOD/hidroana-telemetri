const fs = require('fs');
const path = require('path');

const { TEST_DIR, TEST_CSV_HEADERS, URBAN_TEST_CSV_HEADERS, FLUSH_THRESHOLD } = require('../config');
const state = require('../state');
const { timestampedFileName, formatDuration } = require('../utils/helpers');
const { csvRow } = require('../utils/csv');
const { getActiveVehicle } = require('./systemSettings');
const { VEHICLE_NAMES, testDateAndTime, testArchiveYear, testFileName } = require('./testDetails');
const {
    TEST_EVENT_HEADERS, testFilePath, availableTestName, testStartRecord,
    listTestPaths, readTestRecord, detectTestVehicle
} = require('./testArchive');

const idleTest = {
    active: false,
    stopping: false,
    startTime: null,
    testName: null,
    vehicle: null,
    archiveYear: null,
    pendingTestData: [],
    dataCount: 0,
    fileSize: 0,
    paused: false,
    pausedAt: null,
    pausedElapsed: 0,
    pauseNote: ''
};
const testMode = { ...idleTest };
let stoppingTest = null;
let activeTestFlush = null;

function getTestStatus(now = Date.now()) {
    const { active, paused, testName, vehicle, archiveYear, startTime, pausedAt, pausedElapsed, pauseNote, pendingTestData } = testMode;
    if (!active) return { active, paused };
    const elapsed = Math.max(0, (pausedAt ?? now) - startTime - pausedElapsed);
    return {
        active, paused, testName, vehicle, vehicleName: VEHICLE_NAMES[vehicle], archiveYear, pausedAt, pauseNote, elapsed,
        startTime: new Date(startTime).toISOString(), elapsedFormatted: formatDuration(elapsed),
        pendingData: pendingTestData.length
    };
}

function startTest(details) {
    const now = new Date();
    const vehicle = details?.vehicle ?? getActiveVehicle();
    const archiveYear = details ? testArchiveYear(now) : null;
    const suggestedName = details
        ? testFileName(testDateAndTime(now).date, details)
        : timestampedFileName(`test_${vehicle}`, now);
    const directory = path.dirname(testFilePath(TEST_DIR, suggestedName, archiveYear));
    fs.mkdirSync(directory, { recursive: true });
    const testName = availableTestName(directory, suggestedName);
    Object.assign(testMode, {
        ...idleTest, active: true, startTime: now.getTime(), testName, vehicle, archiveYear,
        pendingTestData: details ? [testStartRecord(details, archiveYear, now)] : []
    });
    state.testVehicle = vehicle;
    if (details) void flushTestDataToFile();
    return getTestStatus(now.getTime());
}

function isActiveTestFile(fileName, archiveYear) {
    return testMode.active && testMode.testName === fileName && testMode.archiveYear === archiveYear;
}

function pauseRecord(endedAt) {
    const { pausedAt, startTime, pausedElapsed, pauseNote } = testMode;
    return {
        record_type: 'pause', test_time: formatDuration(pausedAt - startTime - pausedElapsed),
        event_started_at: new Date(pausedAt).toISOString(), event_ended_at: new Date(endedAt).toISOString(),
        event_duration_ms: endedAt - pausedAt, pause_note: pauseNote
    };
}

// Eşzamanlı durdurma istekleri aynı yazma işleminin tamamlanmasını bekler.
function stopTest() {
    if (stoppingTest) return stoppingTest;
    testMode.stopping = true;
    stoppingTest = finishTest().finally(() => {
        testMode.stopping = false;
        stoppingTest = null;
    });
    return stoppingTest;
}

async function finishTest() {
    const { testName, archiveYear, vehicle, dataCount } = testMode;
    const now = Date.now();
    const realDuration = getTestStatus(now).elapsed;
    const finalRows = [];
    if (archiveYear) {
        if (testMode.paused) finalRows.push(pauseRecord(now));
        finalRows.push({
            record_type: 'test_end', event_ended_at: new Date(now).toISOString(), event_duration_ms: realDuration
        });
    }

    // Son olaylar başarısız bir durdurma girişiminden sonra yeniden oluşturulur.
    if (!await flushTestDataToFile(finalRows)) {
        throw new Error('Test verileri dosyaya kaydedilemedi; kayıt kapatılmadı. Tekrar durdurmayı deneyin.');
    }

    Object.assign(testMode, idleTest);
    state.testVehicle = null;
    return { testName, archiveYear, realDuration, dataCount, vehicle };
}

function pauseTest() {
    testMode.paused = true;
    testMode.pausedAt = Date.now();
    testMode.pauseNote = '';
    void flushTestDataToFile();
    return getTestStatus();
}

function setPauseNote(note) {
    testMode.pauseNote = note;
}

function resumeTest() {
    const now = Date.now();
    const pauseDuration = now - testMode.pausedAt;
    if (testMode.archiveYear) testMode.pendingTestData.push(pauseRecord(now));
    testMode.pausedElapsed += pauseDuration;
    testMode.paused = false;
    testMode.pausedAt = null;
    testMode.pauseNote = '';
    void flushTestDataToFile();
    return pauseDuration;
}

function recordTestData(dataWithTimestamp, now, vehicle = testMode.vehicle) {
    if (!testMode.active || testMode.stopping || testMode.paused || vehicle !== testMode.vehicle) return;
    const elapsed = now.getTime() - testMode.startTime - testMode.pausedElapsed;
    if (elapsed < 0) return;
    testMode.pendingTestData.push({
        ...dataWithTimestamp, test_time: formatDuration(elapsed), record_type: 'telemetry'
    });
    testMode.dataCount++;
    if (testMode.pendingTestData.length >= FLUSH_THRESHOLD) void flushTestDataToFile();
}

async function flushTestDataToFile(finalRows = []) {
    // Kuyruk boş olsa bile, diske alınmış ama henüz tamamlanmamış parti beklenir.
    while (activeTestFlush) await activeTestFlush;
    if (!testMode.active || (!testMode.pendingTestData.length && !finalRows.length)) return true;

    const operation = writePendingTestData(finalRows);
    activeTestFlush = operation;
    try {
        return await operation;
    } finally {
        if (activeTestFlush === operation) activeTestFlush = null;
    }
}

async function writePendingTestData(finalRows) {
    const pending = testMode.pendingTestData;
    testMode.pendingTestData = [];

    const { testName, vehicle, archiveYear, fileSize } = testMode;
    const filePath = testFilePath(TEST_DIR, testName, archiveYear);
    const telemetryHeaders = vehicle === 'urban' ? URBAN_TEST_CSV_HEADERS : TEST_CSV_HEADERS;
    const headers = archiveYear ? [...telemetryHeaders, ...TEST_EVENT_HEADERS] : telemetryHeaders;
    const header = fileSize ? '' : '\uFEFF' + csvRow(headers);
    const content = header + [...pending, ...finalRows].map(data => csvRow(headers.map(key => data[key]))).join('');

    try {
        await fs.promises.appendFile(filePath, content, 'utf8');
        testMode.fileSize += Buffer.byteLength(content);
        return true;
    } catch (error) {
        testMode.pendingTestData = [...pending, ...testMode.pendingTestData];
        try {
            const stats = await fs.promises.stat(filePath);
            if (stats.size > fileSize) await fs.promises.truncate(filePath, fileSize);
        } catch (rollbackError) {
            if (rollbackError.code !== 'ENOENT') console.error('Test CSV yazımı geri alınamadı:', rollbackError);
        }
        return false;
    }
}

async function getTestFiles({ includeDetails = true } = {}) {
    const paths = await listTestPaths(TEST_DIR);
    const files = [];
    for (const entry of paths) {
        if (isActiveTestFile(entry.fileName, entry.archiveYear)) continue;
        try {
            files.push(await readTestRecord(entry, includeDetails));
        } catch (error) {
            if (error.code !== 'ENOENT') console.error('Test dosyası okunamadı:', entry.fileName, error);
        }
    }
    const recordedAt = file => Date.parse(file.startTime || `${file.date}T${file.time || '00:00:00'}`) || file.lastModified.getTime();
    return files.sort((a, b) => b.year - a.year || recordedAt(b) - recordedAt(a));
}

module.exports = {
    testMode, getTestStatus, startTest, stopTest, pauseTest, setPauseNote, resumeTest,
    recordTestData, flushTestDataToFile, isActiveTestFile, detectTestVehicle, getTestFiles
};
