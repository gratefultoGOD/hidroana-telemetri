import { useEffect, useMemo, useState } from 'react'

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--:--:--'
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export default function useLapTiming() {
  const [lapState, setLapState] = useState({
    active: false,
    startTime: null,
    laps: [],
    serverOffset: 0,
  })
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const source = new EventSource('/api/laps/stream', { withCredentials: true })
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.type !== 'lap_update') return
        setLapState({
          active: Boolean(payload.active),
          startTime: Number(payload.startTime) || null,
          laps: Array.isArray(payload.laps) ? payload.laps : [],
          serverOffset: Number(payload.serverTime) ? Number(payload.serverTime) - Date.now() : 0,
        })
      } catch {
        // Bir sonraki lap güncellemesini bekle.
      }
    }
    return () => source.close()
  }, [])

  useEffect(() => {
    if (!lapState.active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [lapState.active])

  return useMemo(() => {
    if (!lapState.startTime) {
      return { lapTime: '--:--:--', totalTime: '--:--:--', active: false }
    }

    const lastLap = lapState.laps.at(-1)
    const effectiveNow = lapState.active
      ? now + lapState.serverOffset
      : (Number(lastLap?.endTime) || lapState.startTime)
    const lapStart = Number(lastLap?.endTime) || lapState.startTime
    const lapDuration = lapState.active
      ? Math.max(0, effectiveNow - lapStart)
      : Number(lastLap?.lapDuration)

    return {
      lapTime: formatDuration(lapDuration),
      totalTime: formatDuration(Math.max(0, effectiveNow - lapState.startTime)),
      active: lapState.active,
    }
  }, [lapState, now])
}
