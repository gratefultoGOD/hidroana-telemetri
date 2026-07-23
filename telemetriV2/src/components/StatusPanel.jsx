import { TEMP_RANGE } from '../hooks/useTelemetryData'
import './SystemPanel.css'
import './StatusPanel.css'

const SENSORS = [
  { key: 't1', label: 'T1 · Batarya Paketi' },
  { key: 't2', label: 'T2 · Yakıt Hücresi' },
  { key: 't3', label: 'T3 · Motor / İnvertör' },
  { key: 'tank', label: 'Tank Sıcaklığı' },
]

const WARNING_AT = 0.6
const DANGER_AT = 0.83

function zoneFor(value) {
  const ratio = (value - TEMP_RANGE.min) / (TEMP_RANGE.max - TEMP_RANGE.min)
  if (ratio >= DANGER_AT) return 'danger'
  if (ratio >= WARNING_AT) return 'warning'
  return 'normal'
}

// Basit etiket/değer satırları — kutucuk yok. Bu kart sıcaklık dışında
// başka durum satırlarıyla da (arıza, durum vb.) büyüyebilsin diye
// gömülü widget yerine düz metin kullanır.
export default function StatusPanel({ temps }) {
  return (
    <section className="system-panel status-panel">
      <header className="system-panel__header">
        <span className="system-panel__icon">ℹ️</span>
        <h2>State</h2>
      </header>
      <div className="status-panel__list">
        {SENSORS.map((s) => {
          const value = temps[s.key]
          const zone = zoneFor(value)
          return (
            <div className="status-row" key={s.key} data-zone={zone}>
              <span className="status-row__label">{s.label}</span>
              <span className="status-row__value">
                {Number.isFinite(value) ? value.toFixed(TEMP_RANGE.decimals) : '--'}
                {TEMP_RANGE.unit}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
