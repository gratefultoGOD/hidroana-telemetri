import { formatTestDuration, testFileUrl, testRequest } from './test-api.mjs'
import { openTestNoteDialog, openTestStartDialog } from './test-dialogs.mjs'

export const INITIAL_TEST_STATE = {
  active: false, paused: false, elapsed: '00:00:00', busy: true, error: '', vehicleName: ''
}

export function createTestControls(defaultVehicle, render) {
  let state = INITIAL_TEST_STATE
  let interval
  let disposed = false

  function update(patch) {
    if (disposed) return
    state = { ...state, ...patch }
    render(state)
  }

  function sync(status) {
    clearInterval(interval)
    if (disposed) return
    const elapsed = status.elapsed ?? 0
    update({
      active: status.active, paused: status.paused, pausedAt: status.pausedAt, pauseNote: status.pauseNote,
      elapsed: formatTestDuration(elapsed), vehicleName: status.vehicleName ?? ''
    })
    if (status.active && !status.paused) {
      const localStart = Date.now() - elapsed
      interval = setInterval(() => update({ elapsed: formatTestDuration(Date.now() - localStart) }), 200)
    }
  }

  async function action(name) {
    if (state.busy || disposed) return null
    update({ busy: true, error: '' })
    try {
      return await testRequest(`/api/test/${name}`, 'POST')
    } catch (error) {
      update({ error: error.message })
      return null
    } finally {
      update({ busy: false })
    }
  }

  function editPauseNote(justPaused = false) {
    if (!state.paused || state.busy || disposed) return
    const { pauseNote, pausedAt } = state
    openTestNoteDialog({
      title: justPaused ? 'Test duraklatıldı' : 'Duraklama notunu düzenle',
      label: 'Duraklama notu', value: pauseNote,
      cancelLabel: justPaused ? 'Atla' : 'Vazgeç',
      onSave: async note => sync(await testRequest('/api/test/pause-note', 'PATCH', { pausedAt, note }))
    })
  }

  testRequest('/api/test/status').then(sync).catch(() => {}).finally(() => update({ busy: false }))

  return {
    start() {
      update({ error: '' })
      void openTestStartDialog(defaultVehicle, async details => sync(await testRequest('/api/test/start', 'POST', details)))
    },
    async stop() {
      const result = await action('stop')
      if (!result || disposed) return
      sync({ active: false, paused: false })
      openTestNoteDialog({
        title: 'Test tamamlandı', label: 'Test sonrası not', summary: `${result.duration} · ${result.dataCount} telemetri kaydı`,
        onSave: async note => {
          if (note.trim()) await testRequest(testFileUrl('after-note', result), 'POST', { note })
        }
      })
    },
    async togglePause() {
      if (!state.active) return
      const paused = state.paused
      const result = await action(paused ? 'resume' : 'pause')
      if (!result || disposed) return
      sync(result)
      if (!paused) editPauseNote(true)
    },
    editPauseNote,
    dispose() {
      disposed = true
      clearInterval(interval)
    }
  }
}
