import { useEffect, useRef, useState } from 'react'
import useTelemetryData, { RANGES } from './hooks/useTelemetryData'
import useLapTiming from './hooks/useLapTiming'
import SystemPanel from './components/SystemPanel'
import StatusPanel from './components/StatusPanel'
import KellyPanel from './components/KellyPanel'
import SpeedPanel from './components/SpeedPanel'
import SatelliteMap from './components/SatelliteMap'
import TestControls from './components/TestControls'
import HeaderNav from './components/HeaderNav'
import './App.css'

function formatClock(date) {
  if (!date) return '--:--:--'
  return date.toLocaleTimeString('tr-TR', { hour12: false })
}

function initialTheme() {
  const savedTheme = window.localStorage.getItem('urban-theme')
  const theme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  document.documentElement.dataset.theme = theme
  return theme
}

export default function App() {
  const data = useTelemetryData()
  const timing = useLapTiming()
  const [theme, setTheme] = useState(initialTheme)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [showChargingEffect, setShowChargingEffect] = useState(false)
  const wasChargingRef = useRef(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('urban-theme', theme)
  }, [theme])

  useEffect(() => {
    let timer
    if (data.charging.active && !wasChargingRef.current) {
      setShowChargingEffect(true)
      timer = setTimeout(() => setShowChargingEffect(false), 1800)
    }
    wasChargingRef.current = data.charging.active
    return () => clearTimeout(timer)
  }, [data.charging.active])

  const batteryMetrics = [
    { label: 'SOC', value: data.batteryMeta.soc, unit: '%', decimals: 0 },
    { label: 'KE', value: data.batteryMeta.ke, unit: 'kWh', decimals: 1 },
  ]
  const fuelCellMetrics = [
    { label: 'İç Sıcaklık', value: data.fuelCellTemps.inner, unit: '°C', decimals: 0 },
    { label: 'Dış Sıcaklık', value: data.fuelCellTemps.outer, unit: '°C', decimals: 0 },
  ]

  return (
    <div className="app">
      {showChargingEffect && (
        <div className="charging-effect" aria-hidden="true">
          <div className="charging-effect__ring" />
          <div className="charging-effect__bolt">ϟ</div>
          <span>ENERJİ AKIŞI</span>
        </div>
      )}

      <header className="app__header">
        <div className="app__header-bar">
          <div className="app__title">
            <span className="app__title-mark">⚡</span>
            <div>
              <h1>URBAN Araç Telemetrisi</h1>
              <p>Canlı tanılama · Batarya · Yakıt Hücresi · Motor</p>
            </div>
          </div>
          <div className="app__header-actions">
            <button
              className="app__theme-btn"
              onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
              title={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
              {theme === 'dark' ? 'Aydınlık' : 'Karanlık'}
            </button>
            <button
              className="app__collapse-btn"
              onClick={() => setHeaderCollapsed((value) => !value)}
              title={headerCollapsed ? 'Başlığı aç' : 'Başlığı kapat'}
              aria-expanded={!headerCollapsed}
            >
              {headerCollapsed ? '▾' : '▴'}
            </button>
          </div>
        </div>

        <div className={`app__header-details ${headerCollapsed ? 'is-collapsed' : ''}`}>
          <div className="app__header-row">
            <div className="app__status">
              <span className={`app__status-dot ${data.connected ? 'is-live' : ''}`} />
              <span>{data.connected ? 'BAĞLI' : 'SİNYAL YOK'}</span>
              <span className="app__last-data">Son veri <strong>{formatClock(data.lastUpdate)}</strong></span>
            </div>
            <TestControls />
            <a className="app__settings-btn" href="/settings" title="Araç ve protokol ayarları">
              ⚙ Ayarlar
            </a>
          </div>
          <HeaderNav />
        </div>
      </header>

      <main className="app__grid">
        <div className="app__cell app__cell--status">
          <aside className="app__right-rail">
            <StatusPanel temps={data.temps} />
            <KellyPanel data={data.kelly} />
          </aside>
        </div>
        <div className="app__cell app__cell--battery">
          <SystemPanel
            title="Batarya"
            icon="🔋"
            data={data.battery}
            ranges={RANGES.battery}
            stats={data.stats.battery}
            sideMetrics={batteryMetrics}
            charging={data.charging}
          />
        </div>
        <div className="app__cell app__cell--speed">
          <SpeedPanel
            speedKph={data.speedKph}
            gpsSpeed={data.gpsSpeed}
            signalStrength={data.signalStrength}
            lapTime={timing.lapTime}
            totalTime={timing.totalTime}
            timingActive={timing.active}
          />
        </div>
        <div className="app__cell app__cell--fuelcell">
          <SystemPanel
            title="Yakıt Hücresi"
            icon="⚗"
            data={data.fuelCell}
            ranges={RANGES.fuelCell}
            stats={data.stats.fuelCell}
            sideMetrics={fuelCellMetrics}
          />
        </div>
        <div className="app__cell app__cell--map">
          <SatelliteMap position={data.position} heading={data.heading} speedKph={data.speedKph} />
        </div>
        <div className="app__cell app__cell--motor">
          <SystemPanel title="Motor" icon="◉" data={data.motor} ranges={RANGES.motor} stats={data.stats.motor} />
        </div>
      </main>

      <footer className="app__footer">
        <span>Canlı telemetri akışı · URBAN aracı</span>
      </footer>
    </div>
  )
}
