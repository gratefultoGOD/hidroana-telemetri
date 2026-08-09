import GaugeDial from './GaugeDial'
import './SystemPanel.css'

function formatMetric(metric) {
  if (!Number.isFinite(metric.value)) return '--'
  return metric.value.toFixed(metric.decimals ?? 0)
}

function ChargingBanner({ charging }) {
  if (!charging?.active) return null

  return (
    <div className="charging-banner" role="status" aria-live="polite">
      <span className="charging-banner__icon" aria-hidden="true">ϟ</span>
      <strong>Şarj Oluyor</strong>
      <span>{charging.voltage.toFixed(1)} V</span>
      <span>{charging.current.toFixed(1)} A</span>
      <span className="charging-banner__time">Tahmini {charging.time || '—'}</span>
    </div>
  )
}

export default function SystemPanel({ title, icon, data, ranges, stats, sideMetrics = [], charging = null }) {
  return (
    <section className="system-panel">
      <header className="system-panel__header">
        <span className="system-panel__icon">{icon}</span>
        <h2>{title}</h2>
        <ChargingBanner charging={charging} />
      </header>

      <div className={`system-panel__content ${sideMetrics.length ? 'has-side-metrics' : ''}`}>
        <div className="system-panel__gauges">
          <GaugeDial
            label="Voltaj"
            value={data.voltage}
            min={ranges.voltage.min}
            max={ranges.voltage.max}
            unit={ranges.voltage.unit}
            decimals={ranges.voltage.decimals}
          />
          <GaugeDial
            label="Akım"
            value={data.current}
            min={ranges.current.min}
            max={ranges.current.max}
            unit={ranges.current.unit}
            decimals={ranges.current.decimals}
          />
          <GaugeDial
            label="Güç"
            value={data.power}
            min={ranges.power.min}
            max={ranges.power.max}
            unit={ranges.power.unit}
            decimals={ranges.power.decimals}
          />
        </div>

        {sideMetrics.length > 0 && (
          <aside className="system-panel__side-metrics">
            {sideMetrics.map((metric) => (
              <div className="system-panel__side-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>
                  {formatMetric(metric)}
                  <em>{metric.unit}</em>
                </strong>
              </div>
            ))}
          </aside>
        )}
      </div>

      {stats && (
        <div className="system-panel__stats">
          <span className="system-panel__stat">
            <span className="system-panel__stat-label">Min Voltaj</span>
            <span className="system-panel__stat-value">
              {Number.isFinite(stats.minVoltage) ? stats.minVoltage.toFixed(ranges.voltage.decimals) : '--'}
              <em>{ranges.voltage.unit}</em>
            </span>
          </span>
          <span className="system-panel__stat">
            <span className="system-panel__stat-label">Maks Akım</span>
            <span className="system-panel__stat-value">
              {Number.isFinite(stats.maxCurrent) ? stats.maxCurrent.toFixed(ranges.current.decimals) : '--'}
              <em>{ranges.current.unit}</em>
            </span>
          </span>
        </div>
      )}
    </section>
  )
}
