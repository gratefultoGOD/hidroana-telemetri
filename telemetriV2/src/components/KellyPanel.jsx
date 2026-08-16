import './SystemPanel.css'
import './KellyPanel.css'
import { decodeKellyErrorMask, normalizeKellyErrorMask } from '../utils/kellyErrors'

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

export default function KellyPanel({ data }) {
  const errorCode = normalizeKellyErrorMask(data.errorCode)
  const activeErrors = decodeKellyErrorMask(errorCode)
  const extraErrors = data.extraErrorCodes
    .map((code, index) => ({ index, code: normalizeKellyErrorMask(code) }))
    .filter((error) => error.code !== 0)
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
        <div className="kelly-error" data-has-error={errorCode !== 0 || extraErrors.length > 0}>
          <div className="kelly-row">
            <span>Hata Kodu</span>
            <strong>{errorCode}</strong>
          </div>
          <div className="kelly-error__messages">
            {activeErrors.length === 0
              ? <p>Hata yok</p>
              : activeErrors.map((error) => <p key={`${error.code}-${error.value}`}>{error.code}: {error.name}</p>)}
          </div>
          {extraErrors.map((extraError) => {
            const decodedErrors = decodeKellyErrorMask(extraError.code)
            const label = decodedErrors.map((error) => `${error.code}: ${error.name}`).join(', ')
            return (
              <small key={extraError.index}>
                Ek hata {extraError.index + 1} ({extraError.code}): {label}
              </small>
            )
          })}
        </div>
      </div>
    </section>
  )
}
