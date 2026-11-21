import './SystemPanel.css'
import './KellyPanel.css'
import { getKellyError, normalizeKellyErrorCode } from '../utils/kellyErrors'

function directionLabel(value) {
  if (value === 0) return 'Geri'
  if (value === 2) return 'İleri'
  return 'Boş'
}

function DataRow({ label, children, tone }) {
  return (
    <div className="kelly-row" data-tone={tone}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

function errorLabel(error) {
  return error.code ? `${error.code}: ${error.name}` : error.name
}

export default function KellyPanel({ data }) {
  const errorCode = normalizeKellyErrorCode(data.errorCode)
  const activeError = getKellyError(errorCode)
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
        <div className="kelly-error" data-has-error={errorCode !== 0}>
          <div className="kelly-row">
            <span>Hata Kodu</span>
            <strong>{errorCode}</strong>
          </div>
          <div className="kelly-error__messages">
            {!activeError
              ? <p>Hata yok</p>
              : <p>{errorLabel(activeError)}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
