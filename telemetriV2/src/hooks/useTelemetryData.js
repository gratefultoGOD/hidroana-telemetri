import { useEffect, useRef, useState } from 'react'

export const RANGES = {
  battery: {
    voltage: { min: 0, max: 60, unit: 'V', decimals: 1 },
    current: { min: 0, max: 40, unit: 'A', decimals: 1 },
    power: { min: 0, max: 2000, unit: 'W', decimals: 0 },
  },
  fuelCell: {
    voltage: { min: 0, max: 50, unit: 'V', decimals: 1 },
    current: { min: 0, max: 30, unit: 'A', decimals: 1 },
    power: { min: 0, max: 1200, unit: 'W', decimals: 0 },
  },
  motor: {
    voltage: { min: 0, max: 60, unit: 'V', decimals: 1 },
    current: { min: 0, max: 50, unit: 'A', decimals: 1 },
    power: { min: 0, max: 2500, unit: 'W', decimals: 0 },
  },
}

export const TEMP_RANGE = { min: 0, max: 120, unit: '°C', decimals: 1 }
export const SPEED_RANGE = { min: 0, max: 160, unit: 'km/h', decimals: 0 }
export const GPS_SPEED_RANGE = { min: 0, max: 160, unit: 'km/h', decimals: 1 }

const STREAM_URL = '/api/urban-telemetry/stream'
const POLL_URL = '/api/urban-telemetry'
const STALE_MS = 5000
const MAX_SSE_RECONNECT = 3
const POLL_MS = 1000
const SSE_RETRY_MS = 60000
const FALLBACK_POSITION = { lat: 52.3888, lng: 4.5409 }

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function num(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isChargingValue(value) {
  if (value === null || value === undefined) return false
  const normalized = String(value).trim().toLocaleLowerCase('tr-TR')
  if (!normalized) return false
  return !['0', 'false', 'no', 'hayır', 'hayir', 'kapalı', 'kapali', 'not_charging', 'not charging'].includes(normalized)
}

function bearingBetween(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const deltaLng = toRad(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function emptyStats() {
  return {
    battery: { maxCurrent: -Infinity, minVoltage: Infinity },
    fuelCell: { maxCurrent: -Infinity, minVoltage: Infinity },
    motor: { maxCurrent: -Infinity, minVoltage: Infinity },
  }
}

function initialState() {
  return {
    battery: { voltage: 0, current: 0, power: 0 },
    fuelCell: { voltage: 0, current: 0, power: 0 },
    motor: { voltage: 0, current: 0, power: 0 },
    stats: emptyStats(),
    temps: { t1: 0, t2: 0, t3: 0, tank: 0 },
    batteryMeta: { soc: 0, ke: 0, maxTemperature: 0 },
    fuelCellTemps: { inner: 0, outer: 0 },
    charging: { active: false, voltage: 0, current: 0, time: '' },
    vehicleControlErrorCodes: [0, 0, 0],
    kelly: {
      enable: 0,
      direction: 1,
      rpm: 0,
      speed: 0,
      throttle: 0,
      temperature: 0,
      errorCode: 0,
    },
    position: FALLBACK_POSITION,
    heading: 0,
    speedKph: 0,
    gpsSpeed: 0,
    signalStrength: 0,
    connected: false,
    lastUpdate: null,
  }
}

export function parseUrbanPayload(raw, previousPosition) {
  const lat = num(raw.x)
  const lng = num(raw.y)
  const hasFix = lat !== 0 || lng !== 0
  const position = hasFix ? { lat, lng } : (previousPosition || FALLBACK_POSITION)
  const heading = hasFix && previousPosition ? bearingBetween(previousPosition, position) : 0
  const maxTemperature = num(raw.max_temperature, Math.max(num(raw.t1), num(raw.t2), num(raw.t3)))
  const receivedAt = new Date(raw.receivedAt || raw.timestamp || Date.now())

  return {
    battery: { voltage: num(raw.bv), current: num(raw.bc), power: num(raw.bw) },
    fuelCell: { voltage: num(raw.fv), current: num(raw.fa), power: num(raw.fw) },
    motor: {
      voltage: num(raw.mv ?? raw.jv),
      current: num(raw.mc ?? raw.jc),
      power: num(raw.mw ?? raw.jw),
    },
    temps: {
      t1: num(raw.t1, maxTemperature),
      t2: num(raw.t2, maxTemperature),
      t3: num(raw.t3, maxTemperature),
      tank: num(raw.T_tank_C),
    },
    batteryMeta: { soc: num(raw.soc), ke: num(raw.ke), maxTemperature },
    fuelCellTemps: { inner: num(raw.fit), outer: num(raw.fet) },
    charging: {
      active: isChargingValue(raw.ischarging),
      voltage: num(raw.charge_voltage),
      current: num(raw.charge_current),
      time: raw.charge_time === null || raw.charge_time === undefined ? '' : String(raw.charge_time),
    },
    vehicleControlErrorCodes: [int(raw.errorcode1), int(raw.errorcode2), int(raw.errorcode3)],
    kelly: {
      enable: int(raw.enable),
      direction: int(raw.fwd_rev ?? raw['fwd/rev'], 1),
      rpm: int(raw.rpm),
      speed: num(raw.controller_speed),
      throttle: clamp(int(raw.throttle), 0, 100),
      temperature: int(raw.controller_temperature),
      errorCode: int(raw.error_code),
    },
    position,
    heading,
    hasFix,
    speedKph: num(raw.h),
    gpsSpeed: num(raw.gsmspeed),
    signalStrength: clamp(int(raw.gs), 0, 32),
    lastUpdate: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
  }
}

export default function useTelemetryData() {
  const [data, setData] = useState(initialState)
  const previousPositionRef = useRef(null)
  const statsRef = useRef(emptyStats())
  const staleTimerRef = useRef(null)

  useEffect(() => {
    let source = null
    let pollTimer = null
    let sseRetryTimer = null
    let reconnectAttempts = 0
    let polling = false
    let closed = false

    const markStale = () => {
      setData((previous) => (previous.connected ? { ...previous, connected: false } : previous))
    }

    const resetStaleTimer = () => {
      clearTimeout(staleTimerRef.current)
      staleTimerRef.current = setTimeout(markStale, STALE_MS)
    }

    const applyRaw = (raw) => {
      const parsed = parseUrbanPayload(raw, previousPositionRef.current)
      if (parsed.hasFix) previousPositionRef.current = parsed.position

      const stats = statsRef.current
      stats.battery.maxCurrent = Math.max(stats.battery.maxCurrent, parsed.battery.current)
      stats.battery.minVoltage = Math.min(stats.battery.minVoltage, parsed.battery.voltage)
      stats.fuelCell.maxCurrent = Math.max(stats.fuelCell.maxCurrent, parsed.fuelCell.current)
      stats.fuelCell.minVoltage = Math.min(stats.fuelCell.minVoltage, parsed.fuelCell.voltage)
      stats.motor.maxCurrent = Math.max(stats.motor.maxCurrent, parsed.motor.current)
      stats.motor.minVoltage = Math.min(stats.motor.minVoltage, parsed.motor.voltage)

      resetStaleTimer()
      setData({
        ...parsed,
        stats: {
          battery: { ...stats.battery },
          fuelCell: { ...stats.fuelCell },
          motor: { ...stats.motor },
        },
        connected: true,
      })
    }

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer)
      if (sseRetryTimer) clearTimeout(sseRetryTimer)
      pollTimer = null
      sseRetryTimer = null
      polling = false
    }

    const connect = () => {
      if (closed) return
      source = new EventSource(STREAM_URL, { withCredentials: true })
      source.onopen = () => { reconnectAttempts = 0 }
      source.onmessage = (event) => {
        try {
          applyRaw(JSON.parse(event.data))
        } catch {
          // Heartbeat veya bozuk telemetri paketi; bir sonraki paketi bekle.
        }
      }
      source.onerror = () => {
        setData((previous) => (previous.connected ? { ...previous, connected: false } : previous))
        if (source) source.close()
        source = null
        if (closed) return

        if (reconnectAttempts < MAX_SSE_RECONNECT) {
          reconnectAttempts += 1
          setTimeout(connect, Math.min(1000 * 2 ** reconnectAttempts, 30000))
        } else {
          startPolling()
        }
      }
    }

    const startPolling = () => {
      if (polling || closed) return
      polling = true
      pollTimer = setInterval(async () => {
        try {
          const response = await fetch(POLL_URL, { credentials: 'same-origin' })
          if (response.ok) applyRaw(await response.json())
        } catch {
          // Ağ tekrar geldiğinde bir sonraki polling turu toparlar.
        }
      }, POLL_MS)
      sseRetryTimer = setTimeout(() => {
        reconnectAttempts = 0
        stopPolling()
        connect()
      }, SSE_RETRY_MS)
    }

    connect()

    return () => {
      closed = true
      clearTimeout(staleTimerRef.current)
      stopPolling()
      if (source) source.close()
    }
  }, [])

  return data
}
