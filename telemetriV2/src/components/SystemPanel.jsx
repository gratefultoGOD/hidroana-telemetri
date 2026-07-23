import GaugeDial from './GaugeDial'
import './SystemPanel.css'

export default function SystemPanel({ title, icon, data, ranges, stats }) {
  return (
    <section className="system-panel">
      <header className="system-panel__header">
        <span className="system-panel__icon">{icon}</span>
        <h2>{title}</h2>
      </header>
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
