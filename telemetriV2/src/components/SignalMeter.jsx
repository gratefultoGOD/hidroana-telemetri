import './SignalMeter.css'

const LEVELS = ['Sinyal Yok', 'Zayıf', 'Orta', 'İyi', 'Çok İyi']

function levelFromSignal(signal) {
  if (signal <= 0) return 0
  return Math.min(4, Math.ceil(signal / 8))
}

export default function SignalMeter({ signal }) {
  const level = levelFromSignal(signal)
  const label = LEVELS[level]
  const zone = level <= 1 ? 'danger' : level === 2 ? 'warning' : 'normal'
  const value = Number.isFinite(signal) ? Math.round(signal) : null

  return (
    <div className="signal-meter" data-zone={zone}>
      <div className="signal-meter__bars">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`signal-meter__bar ${bar <= level ? 'is-active' : ''}`}
            style={{ height: `${bar * 22 + 15}%` }}
          />
        ))}
      </div>
      <div className="signal-meter__text">
        <span className="signal-meter__label">GSM · {label}</span>
        <span className="signal-meter__level">{value !== null ? value : '--'}</span>
      </div>
    </div>
  )
}
