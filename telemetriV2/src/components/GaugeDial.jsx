import { useMemo } from 'react'
import './GaugeDial.css'

const START_ANGLE = -210
const END_ANGLE = 30
const SWEEP = END_ANGLE - START_ANGLE

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle)
  const end = polarToCartesian(cx, cy, r, endAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

export default function GaugeDial({
  label,
  value,
  min = 0,
  max = 100,
  unit = '',
  decimals = 1,
  color = '#2563eb',
  warningAt = 0.7,
  dangerAt = 0.9,
  size = 190,
}) {
  const ratio = clamp((value - min) / (max - min), 0, 1)
  const valueAngle = START_ANGLE + ratio * SWEEP

  const zone = ratio >= dangerAt ? 'danger' : ratio >= warningAt ? 'warning' : 'normal'
  const activeColor = zone === 'danger' ? '#dc2626' : zone === 'warning' ? '#d97706' : color

  const cx = size / 2
  const cy = size / 2 + size * 0.06
  const r = size * 0.38

  const trackPath = useMemo(() => describeArc(cx, cy, r, START_ANGLE, END_ANGLE), [cx, cy, r])
  const warningStartAngle = START_ANGLE + warningAt * SWEEP
  const dangerStartAngle = START_ANGLE + dangerAt * SWEEP
  const warningPath = useMemo(
    () => describeArc(cx, cy, r, warningStartAngle, dangerStartAngle),
    [cx, cy, r, warningStartAngle, dangerStartAngle],
  )
  const dangerPath = useMemo(
    () => describeArc(cx, cy, r, dangerStartAngle, END_ANGLE),
    [cx, cy, r, dangerStartAngle],
  )
  const valuePath = useMemo(() => describeArc(cx, cy, r, START_ANGLE, valueAngle), [cx, cy, r, valueAngle])

  const ticks = useMemo(() => {
    const count = 6
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count
      const angle = START_ANGLE + t * SWEEP
      const outer = polarToCartesian(cx, cy, r + 8, angle)
      const inner = polarToCartesian(cx, cy, r - 2, angle)
      return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, key: i }
    })
  }, [cx, cy, r])

  const needleTip = polarToCartesian(cx, cy, r - 6, valueAngle)
  const needleBase1 = polarToCartesian(cx, cy, size * 0.045, valueAngle + 90)
  const needleBase2 = polarToCartesian(cx, cy, size * 0.045, valueAngle - 90)

  const displayValue = Number.isFinite(value) ? value.toFixed(decimals) : '--'

  return (
    <div className="gauge" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size * 0.9}`} className="gauge__svg">
        <path d={trackPath} className="gauge__track" strokeWidth={size * 0.055} fill="none" />
        <path d={warningPath} className="gauge__zone gauge__zone--warning" strokeWidth={size * 0.055} fill="none" />
        <path d={dangerPath} className="gauge__zone gauge__zone--danger" strokeWidth={size * 0.055} fill="none" />
        <path
          d={valuePath}
          fill="none"
          strokeWidth={size * 0.055}
          strokeLinecap="round"
          style={{ stroke: activeColor }}
        />
        {ticks.map((t) => (
          <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="gauge__tick" />
        ))}
        <line
          x1={needleBase1.x}
          y1={needleBase1.y}
          x2={needleTip.x}
          y2={needleTip.y}
          className="gauge__needle"
          style={{ stroke: activeColor }}
        />
        <line
          x1={needleBase2.x}
          y1={needleBase2.y}
          x2={needleTip.x}
          y2={needleTip.y}
          className="gauge__needle"
          style={{ stroke: activeColor }}
        />
        <circle cx={cx} cy={cy} r={size * 0.05} className="gauge__hub" />
      </svg>
      <div className="gauge__readout">
        <span className="gauge__value" style={{ color: activeColor }}>
          {displayValue}
          <span className="gauge__unit">{unit}</span>
        </span>
        <span className="gauge__label">{label}</span>
      </div>
    </div>
  )
}
