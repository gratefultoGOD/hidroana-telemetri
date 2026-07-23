import './SignalMeter.css'

const LEVELS = ['Sinyal Yok', 'Zayıf', 'Orta', 'İyi', 'Mükemmel']

function levelFromPct(pct) {
  if (pct >= 80) return 4
  if (pct >= 55) return 3
  if (pct >= 30) return 2
  if (pct >= 10) return 1
  return 0
}

// Sinyal kalitesi hem dört kolonlu çubuk göstergesiyle temsil edilir
// hem de sayısal değeri (%) doğrudan yazdırılır.
export default function SignalMeter({ pct }) {
  const level = levelFromPct(pct)
  const label = LEVELS[level]
  const zone = level <= 1 ? 'danger' : level === 2 ? 'warning' : 'normal'
  const value = Number.isFinite(pct) ? Math.round(pct) : null

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
        <span className="signal-meter__label">Sinyal · {label}</span>
        <span className="signal-meter__level">{value !== null ? `${value}%` : '--'}</span>
      </div>
    </div>
  )
}
