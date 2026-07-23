import { useState } from 'react'
import useTelemetryData, { RANGES } from './hooks/useTelemetryData'
import SystemPanel from './components/SystemPanel'
import StatusPanel from './components/StatusPanel'
import SpeedPanel from './components/SpeedPanel'
import SatelliteMap from './components/SatelliteMap'
import TestControls from './components/TestControls'
import HeaderNav from './components/HeaderNav'
import './App.css'

function formatClock(date) {
  if (!date) return '--:--:--'
  return date.toLocaleTimeString('tr-TR', { hour12: false })
}

export default function App() {
  const data = useTelemetryData()
  const [headerCollapsed, setHeaderCollapsed] = useState(false)

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-bar">
          <div className="app__title">
            <span className="app__title-mark">⚡</span>
            <div>
              <h1>URBAN Araç Telemetrisi</h1>
              <p>Canlı tanılama · Batarya · Yakıt Hücresi · Motor</p>
            </div>
          </div>
          <button
            className="app__collapse-btn"
            onClick={() => setHeaderCollapsed((v) => !v)}
            title={headerCollapsed ? 'Başlığı aç' : 'Başlığı kapat'}
            aria-expanded={!headerCollapsed}
          >
            {headerCollapsed ? '▾' : '▴'}
          </button>
        </div>

        <div className={`app__header-details ${headerCollapsed ? 'is-collapsed' : ''}`}>
          <div className="app__header-row">
            <div className="app__status">
              <span className={`app__status-dot ${data.connected ? 'is-live' : ''}`} />
              <span>{data.connected ? 'BAĞLI' : 'SİNYAL YOK'}</span>
              <span className="app__clock">{formatClock(data.lastUpdate)}</span>
            </div>
            <TestControls />
            <a className="app__settings-btn" href="/settings" title="Araç ve protokol ayarları">
              ⚙️ Ayarlar
            </a>
          </div>
          <HeaderNav />
        </div>
      </header>

      <main className="app__grid">
        <div className="app__cell app__cell--status">
          <StatusPanel temps={data.temps} />
        </div>
        <div className="app__cell app__cell--battery">
          <SystemPanel title="Batarya" icon="🔋" data={data.battery} ranges={RANGES.battery} stats={data.stats.battery} />
        </div>
        <div className="app__cell app__cell--speed">
          <SpeedPanel speedKph={data.speedKph} gpsSpeed={data.gpsSpeed} signalPct={data.signalPct} />
        </div>
        <div className="app__cell app__cell--fuelcell">
          <SystemPanel
            title="Yakıt Hücresi"
            icon="⚗️"
            data={data.fuelCell}
            ranges={RANGES.fuelCell}
            stats={data.stats.fuelCell}
          />
        </div>
        <div className="app__cell app__cell--map">
          <SatelliteMap position={data.position} heading={data.heading} speedKph={data.speedKph} />
        </div>
        <div className="app__cell app__cell--motor">
          <SystemPanel title="Motor" icon="🌀" data={data.motor} ranges={RANGES.motor} stats={data.stats.motor} />
        </div>
      </main>

      <footer className="app__footer">
        <span>Canlı telemetri akışı · URBAN aracı</span>
      </footer>
    </div>
  )
}
