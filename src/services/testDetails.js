// Yeni kayıtlar 2027 sezonundan başlar. Tarih, testin başladığı gerçek gündür.
const FIRST_ARCHIVE_YEAR = 2027;
const MAX_NOTE_LENGTH = 4000;
const MAX_PILOT_NAME_LENGTH = 80;

const VEHICLE_NAMES = { proto: 'Gece', urban: 'Dorlion V2' };
const GEAR_RATIO_PURPOSE = 'Farklı dişli oranları';
const TEST_OPTIONS = {
    vehicles: Object.entries(VEHICLE_NAMES).map(([value, name]) => ({
        value,
        label: value === 'urban' ? `${name} (eski adıyla Urban)` : name
    })),
    motors: ['1048', '0124', '0548'],
    powerSources: ['Batarya / Akülü', 'Hidrojenli', 'Hibrit'],
    purposes: [
        { value: 'Pilot seçimi', label: 'Pilot seçimi' },
        { value: 'Motor sürücü testi', label: 'Motor sürücü testi' },
        { value: GEAR_RATIO_PURPOSE, label: GEAR_RATIO_PURPOSE, motor: '1048' }
    ],
    tracks: ['MF arkası', 'Otopark', 'Atölye etrafı', 'S8 yolu'],
    maxNoteLength: MAX_NOTE_LENGTH,
    maxPilotNameLength: MAX_PILOT_NAME_LENGTH
};

const istanbulTime = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function testDateAndTime(at) {
    const { year, month, day, hour, minute, second } = Object.fromEntries(
        istanbulTime.formatToParts(at).map(part => [part.type, part.value])
    );
    return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:${second}` };
}

function testArchiveYear(at) {
    return Math.max(FIRST_ARCHIVE_YEAR, Number(testDateAndTime(at).date.slice(0, 4)));
}

function readTestNote(value = '') {
    if (typeof value !== 'string' || value.length > MAX_NOTE_LENGTH) {
        throw new Error(`Not en fazla ${MAX_NOTE_LENGTH} karakter olabilir.`);
    }
    return value.trim();
}

function readWeight(value, label) {
    const weight = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(weight) || weight <= 0) throw new Error(`${label} kilogram olarak girilmeli.`);
    return weight;
}

function readTestDetails(input = {}) {
    const { vehicle, motor, powerSource, purpose, track } = input ?? {};
    if (typeof vehicle !== 'string' || !Object.hasOwn(VEHICLE_NAMES, vehicle)) throw new Error('Araç seçin.');
    if (!TEST_OPTIONS.motors.includes(motor)) throw new Error('Motor seçin.');
    if (!TEST_OPTIONS.powerSources.includes(powerSource)) throw new Error('Güç kaynağını seçin.');
    if (!TEST_OPTIONS.purposes.some(option => option.value === purpose && (!option.motor || option.motor === motor))) {
        throw new Error('Seçili motora uygun bir test amacı seçin.');
    }
    if (!TEST_OPTIONS.tracks.includes(track)) throw new Error('Pist seçin.');
    const pilotName = typeof input.pilotName === 'string' ? input.pilotName.trim() : '';
    if (!pilotName || pilotName.length > MAX_PILOT_NAME_LENGTH || /[\x00-\x1f]/.test(pilotName)) {
        throw new Error(`Pilot adını girin. En fazla ${MAX_PILOT_NAME_LENGTH} karakter kullanabilirsiniz.`);
    }
    return {
        vehicle, motor, powerSource, purpose, track, pilotName,
        vehicleWeightKg: readWeight(input.vehicleWeightKg, 'Araç kilosu'),
        pilotWeightKg: readWeight(input.pilotWeightKg, 'Pilot kilosu'),
        beforeNotes: readTestNote(input.beforeNotes)
    };
}

module.exports = { TEST_OPTIONS, VEHICLE_NAMES, testDateAndTime, testArchiveYear, readTestDetails, readTestNote };
