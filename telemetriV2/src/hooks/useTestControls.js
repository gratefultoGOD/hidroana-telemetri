import { useEffect, useRef, useState, useCallback } from 'react'

// Mirrors the proto dashboard's test start/pause/stop flow (index.html) against
// the same /api/test/* endpoints — testMode is a single global lock on the
// server, tagged with whichever vehicle was active when the test was started.
const VEHICLE = 'urban'

function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function useTestControls() {
  const [isAdmin, setIsAdmin] = useState(null) // null = still checking
  const [active, setActive] = useState(false)
  const [paused, setPaused] = useState(false)
  const [testName, setTestName] = useState(null)
  const [vehicle, setVehicle] = useState(null)
  const [elapsedFormatted, setElapsedFormatted] = useState('00:00:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const startTimeRef = useRef(null)
  const tickRef = useRef(null)

  const stopTicking = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const startTicking = useCallback(() => {
    stopTicking()
    tickRef.current = setInterval(() => {
      setElapsedFormatted(formatDuration(Date.now() - startTimeRef.current))
    }, 200)
  }, [stopTicking])

  // Admin gate — test controls are admin-only, same as the proto dashboard
  useEffect(() => {
    fetch('/api/auth/check')
      .then((res) => res.json())
      .then((data) => setIsAdmin(!!data.authenticated && data.user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])

  // Sync current server-side test state once we know we're admin
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/test/status')
      .then((res) => res.json())
      .then((data) => {
        if (!data.active) return
        setActive(true)
        setPaused(!!data.paused)
        setTestName(data.testName)
        setVehicle(data.vehicle)
        startTimeRef.current = Date.now() - data.elapsed
        setElapsedFormatted(formatDuration(data.elapsed))
        if (!data.paused) startTicking()
      })
      .catch(() => { /* no active test, or unreachable — ignore */ })

    return stopTicking
  }, [isAdmin, startTicking, stopTicking])

  const start = useCallback(() => {
    setBusy(true)
    setError(null)
    fetch('/api/test/start', { method: 'POST' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setActive(true)
          setPaused(false)
          setTestName(data.testName)
          setVehicle(data.vehicle)
          startTimeRef.current = Date.now()
          setElapsedFormatted('00:00:00')
          startTicking()
        } else {
          setError(data.error || 'Failed to start test')
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false))
  }, [startTicking])

  const stop = useCallback(() => {
    setBusy(true)
    setError(null)
    fetch('/api/test/stop', { method: 'POST' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          stopTicking()
          setActive(false)
          setPaused(false)
          setTestName(null)
          setVehicle(null)
          setElapsedFormatted('00:00:00')
          return { testName: data.testName, duration: data.duration, dataCount: data.dataCount }
        }
        setError(data.error || 'Failed to stop test')
        return null
      })
      .catch((err) => {
        setError(err.message)
        return null
      })
      .finally(() => setBusy(false))
  }, [stopTicking])

  const pause = useCallback(() => {
    setBusy(true)
    setError(null)
    fetch('/api/test/pause', { method: 'POST' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setPaused(true)
          stopTicking()
        } else {
          setError(data.error || 'Failed to pause test')
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false))
  }, [stopTicking])

  const resume = useCallback(() => {
    setBusy(true)
    setError(null)
    fetch('/api/test/resume', { method: 'POST' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          return fetch('/api/test/status')
            .then((r) => r.json())
            .then((st) => {
              if (st.active && !st.paused) {
                startTimeRef.current = Date.now() - st.elapsed
                setPaused(false)
                startTicking()
              }
            })
        }
        setError(data.error || 'Failed to resume test')
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false))
  }, [startTicking])

  const togglePause = useCallback(() => {
    if (!active) return
    if (paused) resume()
    else pause()
  }, [active, paused, pause, resume])

  return {
    isAdmin,
    active,
    paused,
    testName,
    vehicle,
    vehicleMismatch: active && vehicle != null && vehicle !== VEHICLE,
    elapsedFormatted,
    busy,
    error,
    start,
    stop,
    togglePause,
  }
}
