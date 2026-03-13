const fs = require('fs');
const path = require('path');

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ========== CSV ==========
function calculateFromCSV(csvPath) {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split(/\r?\n/);
    const header = lines[0].split(',');
    const longIdx = header.indexOf('LongX');
    const latIdx = header.indexOf('LatY');

    const coords = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const lon = parseFloat(parts[longIdx]);
        const lat = parseFloat(parts[latIdx]);
        if (!isNaN(lon) && !isNaN(lat)) {
            coords.push({ lat, lon });
        }
    }

    let totalDistance = 0;
    const segmentDistances = [];
    for (let i = 1; i < coords.length; i++) {
        const d = calculateDistance(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon);
        segmentDistances.push(d);
        totalDistance += d;
    }

    const lastLine = lines[lines.length - 1].split(',');
    const csvReportedDistance = parseFloat(lastLine[0]);

    return { pointCount: coords.length, totalDistance, csvReportedDistance, firstPoint: coords[0], lastPoint: coords[coords.length - 1] };
}

// ========== KML ==========
function calculateFromKML(kmlPath) {
    const kmlContent = fs.readFileSync(kmlPath, 'utf-8');
    const coordMatch = kmlContent.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!coordMatch) throw new Error('KML coordinates not found');

    const pairs = coordMatch[1].trim().split(/\s+/);
    const coords = [];
    for (const pair of pairs) {
        const parts = pair.split(',');
        if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lon) && !isNaN(lat)) coords.push({ lat, lon });
        }
    }

    let totalDistance = 0;
    for (let i = 1; i < coords.length; i++) {
        totalDistance += calculateDistance(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon);
    }

    return { pointCount: coords.length, totalDistance, firstPoint: coords[0], lastPoint: coords[coords.length - 1] };
}

// ========== RUN ==========
const csvResult = calculateFromCSV(path.join(__dirname, 'sem_2025_eu.csv'));
const kmlResult = calculateFromKML(path.join(__dirname, 'sem-eu-2025-track.kml'));

const csvKmlDiffPercent = Math.abs(csvResult.totalDistance - kmlResult.totalDistance) / csvResult.totalDistance * 100;

const results = {
    CSV: {
        pointCount: csvResult.pointCount,
        haversineDistance_m: +csvResult.totalDistance.toFixed(3),
        haversineDistance_km: +(csvResult.totalDistance / 1000).toFixed(4),
        reportedDistance_m: csvResult.csvReportedDistance,
        reportedDistance_km: +(csvResult.csvReportedDistance / 1000).toFixed(4),
        haversineVsReported_diff_m: +Math.abs(csvResult.totalDistance - csvResult.csvReportedDistance).toFixed(3),
        firstPoint: csvResult.firstPoint,
        lastPoint: csvResult.lastPoint
    },
    KML: {
        pointCount: kmlResult.pointCount,
        haversineDistance_m: +kmlResult.totalDistance.toFixed(3),
        haversineDistance_km: +(kmlResult.totalDistance / 1000).toFixed(4),
        firstPoint: kmlResult.firstPoint,
        lastPoint: kmlResult.lastPoint
    },
    COMPARISON: {
        csvHaversine_vs_kmlHaversine_diff_m: +Math.abs(csvResult.totalDistance - kmlResult.totalDistance).toFixed(3),
        csvHaversine_vs_kmlHaversine_diff_percent: +csvKmlDiffPercent.toFixed(4),
        csvIsLonger: csvResult.totalDistance > kmlResult.totalDistance,
        closerToCSVReported: Math.abs(csvResult.totalDistance - csvResult.csvReportedDistance) < Math.abs(kmlResult.totalDistance - csvResult.csvReportedDistance) ? 'CSV Haversine' : 'KML Haversine'
    }
};

const outputPath = path.join(__dirname, 'distance_results.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
console.log('Results saved to: ' + outputPath);
console.log(JSON.stringify(results, null, 2));
