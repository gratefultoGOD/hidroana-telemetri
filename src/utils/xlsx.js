// ============================================
// CSV → XLSX DÖNÜŞTÜRME YARDIMCISI
// ============================================
const XLSX = require('xlsx');

// CSV içeriğini XLSX buffer'a dönüştür (semicolon separated)
function csvToXlsxBuffer(csvContent, sheetName = 'Veri') {
    // BOM karakterini kaldır
    const cleanCsv = csvContent.replace(/^\uFEFF/, '');
    const lines = cleanCsv.split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;

    const rows = lines.map(line => {
        return line.split(';').map(cell => {
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
