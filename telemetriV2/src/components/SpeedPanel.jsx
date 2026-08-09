import GaugeDial from './GaugeDial'
import SignalMeter from './SignalMeter'
import { SPEED_RANGE, GPS_SPEED_RANGE } from '../hooks/useTelemetryData'
import './SystemPanel.css'
import './SpeedPanel.css'

export default function SpeedPanel({ speedKph, gpsSpeed, signalStrength, lapTime, totalTime, timingActive }) {
  return (
    <section className="system-panel speed-panel">
      <header className="system-panel__header">
        <span className="system-panel__icon">🚗</span>
        <h2>Araç Hızı</h2>
      </header>
      <div className="speed-panel__body">
        <GaugeDial
          label="Hız"
          value={speedKph}
          min={SPEED_RANGE.min}
          max={SPEED_RANGE.max}
          unit={SPEED_RANGE.unit}
          decimals={SPEED_RANGE.decimals}
          warningAt={0.75}
          dangerAt={0.92}
        />
        <div className="speed-panel__gps">
          <span className="speed-panel__gps-label">GPS Hızı</span>
          <span className="speed-panel__gps-value">
            {Number.isFinite(gpsSpeed) ? gpsSpeed.toFixed(GPS_SPEED_RANGE.decimals) : '--'}
            <em>{GPS_SPEED_RANGE.unit}</em>
          </span>
        </div>
        <SignalMeter signal={signalStrength} />
        <div className="speed-panel__timing" data-active={timingActive}>
          <span className="speed-panel__timing-row">
            <span>Tur Süresi</span>
            <strong>{lapTime}</strong>
          </span>
          <span className="speed-panel__timing-row">
            <span>Toplam Süre</span>
            <strong>{totalTime}</strong>
          </span>
        </div>
      </div>
    </section>
  )
}
