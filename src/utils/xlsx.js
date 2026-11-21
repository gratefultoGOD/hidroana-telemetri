// ============================================
// CSV → XLSX DÖNÜŞTÜRME YARDIMCISI
// ============================================
const XLSX = require('xlsx');
const { parseCsvRows } = require('./csv');

// CSV içeriğini XLSX buffer'a dönüştür (semicolon separated)
function csvToXlsxBuffer(csvContent, sheetName = 'Veri', textColumns = []) {
    const csv = parseCsvRows(csvContent);
    if (csv.length === 0) return null;
    const textIndices = new Set(textColumns.map(name => csv[0].indexOf(name)));

    const rows = csv.map(row => {
        return row.map((cell, index) => {
            if (textIndices.has(index)) return cell;
            const trimmed = cell.trim();
            // Sayısal değerleri number olarak dönüştür (date/time hariç)
            const num = Number(trimmed);
            if (trimmed !== '' && !isNaN(num) && !trimmed.includes(':') && !trimmed.includes('-')) {
                return num;
            }
            return trimmed;
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { csvToXlsxBuffer };
