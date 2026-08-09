import './SystemPanel.css'
import './KellyPanel.css'

// Kontrolcü üreticisinin tam hata listesi geldiğinde bu tablo genişletilecek.
// Şimdilik talepte verilen örnek kod tanımlıdır; bilinmeyen kodlar ham değerleriyle görünür.
const KELLY_ERROR_CODES = {
  0: 'Hata yok',
  32: 'Over voltage',
}

function directionLabel(value) {
  if (value === 0) return 'Geri'
  if (value === 2) return 'İleri'
  return 'Boş'
}

function errorLabel(code) {
  return KELLY_ERROR_CODES[code] || 'Tanımsız hata kodu'
}

function DataRow({ label, children, tone }) {
  return (
    <div className="kelly-row" data-tone={tone}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

export default function KellyPanel({ data }) {
  const extraErrors = data.extraErrorCodes.filter((code) => code !== 0)
  const throttleTone = data.throttle >= 85 ? 'danger' : data.throttle >= 60 ? 'warning' : 'normal'

  return (
    <section className="system-panel kelly-panel">
      <header className="system-panel__header">
        <span className="system-panel__icon">⚙</span>
        <h2>Kelly Motor Controller</h2>
      </header>

      <div className="kelly-panel__list">
        <DataRow label="Enable" tone={data.enable === 1 ? 'success' : 'muted'}>
          {data.enable === 1 ? 'Açık' : 'Kapalı'}
        </DataRow>
        <DataRow label="FWD / REV">{directionLabel(data.direction)}</DataRow>
        <DataRow label="RPM">{data.rpm.toLocaleString('tr-TR')}</DataRow>
        <DataRow label="Hız">{data.speed.toFixed(1)} <em>km/h</em></DataRow>

        <div className="kelly-throttle" data-tone={throttleTone}>
          <div className="kelly-throttle__head">
            <span>Throttle</span>
            <strong>{data.throttle}%</strong>
          </div>
          <div className="kelly-throttle__track" role="meter" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100" aria-valuenow={data.throttle}>
            <span style={{ width: `${data.throttle}%` }} />
          </div>
        </div>

        <DataRow label="Sıcaklık" tone={data.temperature >= 85 ? 'danger' : data.temperature >= 65 ? 'warning' : undefined}>
          {data.temperature} <em>°C</em>
        </DataRow>
        <div className="kelly-error" data-has-error={data.errorCode !== 0}>
          <div className="kelly-row">
            <span>Hata Kodu</span>
            <strong>{data.errorCode}</strong>
          </div>
          <p>{errorLabel(data.errorCode)}</p>
          {extraErrors.length > 0 && (
            <small>Ek kodlar: {extraErrors.join(', ')}</small>
          )}
        </div>
      </div>
    </section>
  )
}
