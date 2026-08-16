export const KELLY_ERROR_BITS = [
  { position: 0, value: 1, name: 'Identification error' },
  { position: 1, value: 2, name: 'Over voltage' },
  { position: 2, value: 4, name: 'Low voltage' },
  { position: 3, value: 8, name: 'Reserved' },
  { position: 4, value: 16, name: 'Stall' },
  { position: 5, value: 32, name: 'Internal volts fault' },
  { position: 6, value: 64, name: 'Over temperature' },
  { position: 7, value: 128, name: 'Throttle error at power-up' },
  { position: 8, value: 256, name: 'Reserved' },
  { position: 9, value: 512, name: 'Internal reset' },
  { position: 10, value: 1024, name: 'Hall throttle is open or short-circuit' },
  { position: 11, value: 2048, name: 'Angle sensor error' },
  { position: 12, value: 4096, name: 'Reserved' },
  { position: 13, value: 8192, name: 'Reserved' },
  { position: 14, value: 16384, name: 'Motor over-temperature' },
  { position: 15, value: 32768, name: 'Hall Galvanometer sensor error' },
]

const KNOWN_ERROR_MASK = KELLY_ERROR_BITS.reduce((mask, error) => mask + error.value, 0)

export function normalizeKellyErrorMask(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0
}

export function decodeKellyErrorMask(value) {
  const mask = normalizeKellyErrorMask(value)
  if (mask === 0) return []

  const activeErrors = KELLY_ERROR_BITS
    .filter((error) => (mask & error.value) === error.value)
    .map((error) => ({ ...error, code: `ERR${error.position}` }))

  const unknownValue = mask - (mask & KNOWN_ERROR_MASK)
  if (unknownValue > 0) {
    activeErrors.push({ position: null, value: unknownValue, code: 'ERR?', name: `Unknown error bits (${unknownValue})` })
  }

  return activeErrors
}
