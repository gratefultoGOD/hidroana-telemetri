function csvRow(values) {
    return values.map(value => {
        const text = String(value ?? '');
        return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(';') + '\n';
}

function parseCsvRows(content) {
    const csv = content.replace(/^\uFEFF/, '');
    if (!csv.includes('"')) {
        return csv.split(/\r\n|\n|\r/).filter(line => line.trim()).map(line => line.split(';'));
    }

    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < csv.length; index++) {
        const char = csv[index];
        if (quoted) {
            if (char === '"' && csv[index + 1] === '"') {
                value += char;
                index++;
            } else if (char === '"') {
                quoted = false;
            } else {
                value += char;
            }
        } else if (char === '"' && !value) {
            quoted = true;
        } else if (char === ';') {
            row.push(value);
            value = '';
        } else if (char === '\r' || char === '\n') {
            if (row.length || value.trim()) rows.push([...row, value]);
            row = [];
            value = '';
            if (char === '\r' && csv[index + 1] === '\n') index++;
        } else {
            value += char;
        }
    }
    if (row.length || value.trim()) rows.push([...row, value]);
    return rows;
}

module.exports = { csvRow, parseCsvRows };
