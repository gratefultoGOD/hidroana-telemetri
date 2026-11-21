const START_ANGLE = -210
const SWEEP = 240

function polarToCartesian(cx, cy, radius, angle) {
  const radians = angle * Math.PI / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, startAngle)
  const end = polarToCartesian(cx, cy, radius, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

export function createGaugeScale({ size = 190, warningAt = 0.7, dangerAt = 0.9 } = {}) {
  const cx = size / 2
  const cy = size / 2 + size * 0.06
  const radius = size * 0.38
  const endAngle = START_ANGLE + SWEEP
  const warningAngle = START_ANGLE + warningAt * SWEEP
  const dangerAngle = START_ANGLE + dangerAt * SWEEP
  const ticks = Array.from({ length: 7 }, (_, key) => {
    const angle = START_ANGLE + key / 6 * SWEEP
    const inner = polarToCartesian(cx, cy, radius - 2, angle)
    const outer = polarToCartesian(cx, cy, radius + 8, angle)
    return { key, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }
  })

  return {
    size, cx, cy, radius, warningAt, dangerAt, ticks,
    trackPath: describeArc(cx, cy, radius, START_ANGLE, endAngle),
    warningPath: describeArc(cx, cy, radius, warningAngle, dangerAngle),
    dangerPath: describeArc(cx, cy, radius, dangerAngle, endAngle),
  }
}

export function getGaugeReading(scale, value, { min = 0, max = 100, color = '#4f8cff' } = {}) {
  const { size, cx, cy, radius, warningAt, dangerAt } = scale
  const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const angle = START_ANGLE + ratio * SWEEP
  const activeColor = ratio >= dangerAt ? '#f87171' : ratio >= warningAt ? '#f59e0b' : color

  return {
    activeColor,
    valuePath: describeArc(cx, cy, radius, START_ANGLE, angle),
    needleTip: polarToCartesian(cx, cy, radius - 6, angle),
    needleBase1: polarToCartesian(cx, cy, size * 0.045, angle + 90),
    needleBase2: polarToCartesian(cx, cy, size * 0.045, angle - 90),
  }
}
