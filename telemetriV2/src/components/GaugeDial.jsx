import { useMemo } from 'react'
import { createGaugeScale, getGaugeReading } from './gaugeGeometry.mjs'
import './GaugeDial.css'

export default function GaugeDial({
  label,
  value,
  min = 0,
  max = 100,
  unit = '',
  decimals = 1,
  paired = false,
  secondaryValue = null,
  readoutDecimals = decimals,
  color = '#4f8cff',
  warningAt = 0.7,
  dangerAt = 0.9,
  size = 190,
}) {
  const scale = useMemo(() => createGaugeScale({ size, warningAt, dangerAt }), [size, warningAt, dangerAt])
  const { cx, cy, trackPath, warningPath, dangerPath, ticks } = scale
  const { activeColor, valuePath, needleTip, needleBase1, needleBase2 } = getGaugeReading(scale, value, { min, max, color })

  const displayValue = Number.isFinite(value) ? value.toFixed(readoutDecimals) : '--'
  const secondaryDisplayValue = Number.isFinite(secondaryValue) ? secondaryValue.toFixed(readoutDecimals) : '--'

  return (
    <div className={`gauge${paired ? ' gauge--paired' : ''}`}>
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
        <span className="gauge__value" style={{ color: activeColor }} title={paired ? 'Sol: Fuel Cell / Sağ: EYS · Kadran: Fuel Cell' : undefined}>
          {displayValue}
          <span className="gauge__unit">{unit}</span>
          {paired && (
            <>
              <span className="gauge__separator"> / </span>
              <span className="gauge__secondary">
                {secondaryDisplayValue}<span className="gauge__unit">{unit}</span>
              </span>
            </>
          )}
        </span>
        <span className="gauge__label">{label}{paired ? ' · FC / EYS' : ''}</span>
      </div>
    </div>
  )
}
