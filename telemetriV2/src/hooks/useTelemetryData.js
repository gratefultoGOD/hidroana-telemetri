import { useEffect, useRef, useState } from 'react'

// Gösterge (gauge) kadranlarının çalışma aralıkları.
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
  // URBAN aracında motor telemetrisi joulemetre kanalından (jv/jc/jw/jwh)
  // okunur ve "Motor" panelinde gösterilir.
  motor: {
    voltage: { min: 0, max: 60, unit: 'V', decimals: 1 },
    current: { min: 0, max: 50, unit: 'A', decimals: 1 },
    power: { min: 0, max: 2500, unit: 'W', decimals: 0 },
  },
}

export const TEMP_RANGE = { min: 0, max: 120, unit: '°C', decimals: 1 }
export const SPEED_RANGE = { min: 0, max: 160, unit: 'km/h', decimals: 0 }
export const GPS_SPEED_RANGE = { min: 0, max: 160, unit: 'km/h', decimals: 1 }

// URBAN aracının MQTT topic'inden beslenen canlı SSE ucu (server.js / dataSource.js).
const STREAM_URL = '/api/urban-telemetry/stream'
// SSE tamamen başarısız olursa dönülecek polling ucu.
const POLL_URL = '/api/urban-telemetry'

// Bu süre içinde veri gelmezse arayüz "SİNYAL YOK" durumuna düşer.
const STALE_MS = 5000
// Polling fallback ayarları — yalnızca SSE kurulamadığında devreye girer.
const MAX_SSE_RECONNECT = 3   // Bu kadar başarısız denemeden sonra polling'e geç
const POLL_MS = 1000          // Polling modunda veri çekme aralığı
const SSE_RETRY_MS = 60000    // Polling'deyken SSE'yi tekrar deneme aralığı

// İlk gerçek GPS düzeltmesi gelene kadar gösterilecek varsayılan harita merkezi.
const FALLBACK_POSITION = { lat: 52.3888, lng: 4.5409 }

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function num(v, fallback = 0) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

// İki lat/lng noktası arasındaki pusula açısı (0-360°). Harita işaretçisi
// aracın gittiği yöne dönsün diye kullanılır. URBAN string'inde yön/yaw
// alanı olmadığından ardışık GPS düzeltmelerinden hesaplanır.
function bearingBetween(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLng = toRad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
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
    position: FALLBACK_POSITION,
    heading: 0,
    speedKph: 0,
    gpsSpeed: 0,
    signalPct: 0,
    connected: false,
    lastUpdate: null,
  }
}

// Bir URBAN telemetri SSE/polling yükünü (sunucu alan adları — bkz.
// config.URBAN_DATA_FIELDS) panolu bileşenlerin beklediği şekle çevirir.
//
// Alan eşlemesi:
//  - h            -> speedKph (araç hızı)
//  - gsmspeed     -> gpsSpeed (GSM tabanlı hız)
//  - gs           -> signalPct (GSM sinyal kalitesi)
//  - ham x -> lat, ham y -> lng (ana araç geleneğiyle uyumlu)
//  - bv/bc/bw     -> batarya
//  - fv/fa/fw     -> yakıt hücresi
//  - jv/jc/jw     -> motor (URBAN'da joulemetre kanalı motoru temsil eder)
//  - t1/t2/t3     -> durum panelindeki sıcaklıklar
//  - T_tank_C     -> hidrojen tank sıcaklığı
function parseUrbanPayload(raw, prevPosition) {
  const lat = num(raw.x)
  const lng = num(raw.y)
  const hasFix = lat !== 0 || lng !== 0
  const position = hasFix ? { lat, lng } : (prevPosition || FALLBACK_POSITION)
  const heading = hasFix && prevPosition ? bearingBetween(prevPosition, position) : 0

  return {
    battery: { voltage: num(raw.bv), current: num(raw.bc), power: num(raw.bw) },
    fuelCell: { voltage: num(raw.fv), current: num(raw.fa), power: num(raw.fw) },
    motor: { voltage: num(raw.jv), current: num(raw.jc), power: num(raw.jw) },
    temps: { t1: num(raw.t1), t2: num(raw.t2), t3: num(raw.t3), tank: num(raw.T_tank_C) },
    position,
    heading,
    hasFix,
    speedKph: num(raw.h),
    gpsSpeed: num(raw.gsmspeed),
    signalPct: clamp(num(raw.gs), 0, 100),
    lastUpdate: new Date(raw.receivedAt || raw.timestamp || Date.now()),
  }
}

export default function useTelemetryData() {
  const [data, setData] = useState(initialState)
  const prevPositionRef = useRef(null)
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
      setData((prev) => (prev.connected ? { ...prev, connected: false } : prev))
    }

    const resetStaleTimer = () => {
      clearTimeout(staleTimerRef.current)
      staleTimerRef.current = setTimeout(markStale, STALE_MS)
    }

    // Ham telemetri yükünü işleyip state'e uygula (hem SSE hem polling kullanır).
    const applyRaw = (raw) => {
      const parsed = parseUrbanPayload(raw, prevPositionRef.current)
      if (parsed.hasFix) prevPositionRef.current = parsed.position

      const s = statsRef.current
      s.battery.maxCurrent = Math.max(s.battery.maxCurrent, parsed.battery.current)
      s.battery.minVoltage = Math.min(s.battery.minVoltage, parsed.battery.voltage)
      s.fuelCell.maxCurrent = Math.max(s.fuelCell.maxCurrent, parsed.fuelCell.current)
      s.fuelCell.minVoltage = Math.min(s.fuelCell.minVoltage, parsed.fuelCell.voltage)
      s.motor.maxCurrent = Math.max(s.motor.maxCurrent, parsed.motor.current)
      s.motor.minVoltage = Math.min(s.motor.minVoltage, parsed.motor.voltage)

      resetStaleTimer()

      setData({
        battery: parsed.battery,
        fuelCell: parsed.fuelCell,
        motor: parsed.motor,
        stats: {
          battery: { ...s.battery },
          fuelCell: { ...s.fuelCell },
          motor: { ...s.motor },
        },
        temps: parsed.temps,
        position: parsed.position,
        heading: parsed.heading,
        speedKph: parsed.speedKph,
        gpsSpeed: parsed.gpsSpeed,
        signalPct: parsed.signalPct,
        connected: true,
        lastUpdate: parsed.lastUpdate,
      })
    }

    // ── POLLING FALLBACK — yalnızca SSE tamamen başarısız olursa ──
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = null }
      polling = false
    }

    const startPolling = () => {
      if (polling || closed) return
      polling = true
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(POLL_URL, { credentials: 'same-origin' })
          if (!res.ok) return // 503 = taze veri yok; stale watchdog bağlantıyı düşürür
          applyRaw(await res.json())
        } catch { /* ağ hatası — bir sonraki tur tekrar dene */ }
      }, POLL_MS)

      // Belirli aralıklarla SSE'yi tekrar dene; başarılı olursa polling'i bırak.
      sseRetryTimer = setTimeout(() => {
        reconnectAttempts = 0
        stopPolling()
        connect()
      }, SSE_RETRY_MS)
    }

    // ── SSE (birincil, olay güdümlü) ──
    const connect = () => {
      if (closed) return
      source = new EventSource(STREAM_URL, { withCredentials: true })

      source.onopen = () => { reconnectAttempts = 0 }

      source.onmessage = (event) => {
        let raw
        try {
          raw = JSON.parse(event.data)
        } catch {
          return // heartbeat/yorum satırı veya bozuk yük — yok say
        }
        applyRaw(raw)
      }

      source.onerror = () => {
        setData((prev) => (prev.connected ? { ...prev, connected: false } : prev))
        if (source) { source.close(); source = null }
        if (closed) return

        if (reconnectAttempts < MAX_SSE_RECONNECT) {
          reconnectAttempts++
          const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
          setTimeout(connect, delay)
        } else {
          // SSE kurulamıyor — polling fallback'e geç.
          startPolling()
        }
      }
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
