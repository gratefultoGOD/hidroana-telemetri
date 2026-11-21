export const KELLY_ERROR_CODES = [
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

export function normalizeKellyErrorCode(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0
}

export function getKellyError(value) {
  const errorCode = normalizeKellyErrorCode(value)
  if (errorCode === 0) return null

  const error = KELLY_ERROR_CODES.find((item) => item.value === errorCode)
  if (!error) return { position: null, value: errorCode, code: null, name: 'Tanımsız hata kodu' }

  return { ...error, code: `ERR${error.position}` }
}
