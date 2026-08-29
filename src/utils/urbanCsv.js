const fs = require('fs');
const path = require('path');

const URBAN_FILE_SUFFIX = '_urban_verileri.csv';

function readHeader(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(8192);
        const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        return buffer.toString('utf8', 0, length).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    } finally {
        fs.closeSync(descriptor);
    }
}

// Eski günlük dosyanın altına farklı sütun sırasıyla veri ekleme.
// Var olan kayıtları koru; aynı günün yeni şemasını ayrı dosyada sürdür.
function resolveUrbanDailyFileName(directory, baseFileName, headers) {
    const expectedHeader = headers.join(';');
    const datePart = baseFileName.slice(0, -URBAN_FILE_SUFFIX.length);
    for (let version = 1; ; version++) {
        const fileName = version === 1 ? baseFileName : `${datePart}_v${version}${URBAN_FILE_SUFFIX}`;
        const filePath = path.join(directory, fileName);
        if (!fs.existsSync(filePath) || readHeader(filePath) === expectedHeader) return fileName;
    }
}

// Eski ve yeni CSV'leri sütun adlarına göre birleştir. Eski total_flow,
// güncel flow'a eşlenir; anlık eski flow toplamın yerine geçirilmez.
function combineUrbanCsvContents(contents, currentHeaders, withBom = true) {
    const sources = contents.map(content => {
        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
        return { headers: (lines.shift() || '').split(';'), lines };
    });
    const headers = currentHeaders.filter(header => header !== 'total_flow');
    for (const source of sources) {
        for (const header of source.headers) {
            if (header && header !== 'total_flow' && !headers.includes(header)) headers.push(header);
        }
    }
    let csv = (withBom ? '\uFEFF' : '') + headers.join(';') + '\n';
    for (const source of sources) {
        const legacyTotalIndex = source.headers.indexOf('total_flow');
        const indices = headers.map(header => header === 'flow' && legacyTotalIndex >= 0
            ? legacyTotalIndex : source.headers.indexOf(header));
        for (const line of source.lines) {
            const values = line.split(';');
            csv += indices.map(index => index < 0 ? '' : (values[index] ?? '')).join(';') + '\n';
        }
    }
    return csv;
}

module.exports = { URBAN_FILE_SUFFIX, resolveUrbanDailyFileName, combineUrbanCsvContents };
