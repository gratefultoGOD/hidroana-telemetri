import { useEffect, useRef, useState } from 'react'
import { createTestControls, INITIAL_TEST_STATE } from '../test/test-controls.mjs'

export default function useTestControls() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [test, setTest] = useState(INITIAL_TEST_STATE)
  const controller = useRef(null)

  useEffect(() => {
    const abort = new AbortController()
    fetch('/api/auth/check', { signal: abort.signal })
      .then(response => response.json())
      .then(data => setIsAdmin(!!data.authenticated && data.user?.role === 'admin'))
      .catch(() => {})
    return () => abort.abort()
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    const controls = createTestControls('urban', setTest)
    controller.current = controls
    return () => {
      controls.dispose()
      controller.current = null
    }
  }, [isAdmin])

  return {
    ...test, isAdmin,
    start: () => controller.current?.start(),
    stop: () => controller.current?.stop(),
    togglePause: () => controller.current?.togglePause(),
    editPauseNote: () => controller.current?.editPauseNote()
  }
}
