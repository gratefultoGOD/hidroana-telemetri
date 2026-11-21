import useTestControls from '../hooks/useTestControls'
import '../test/test-ui.css'
import './TestControls.css'

export default function TestControls() {
  const {
    isAdmin,
    active,
    paused,
    elapsed,
    vehicleName,
    busy,
    error,
    start,
    stop,
    togglePause,
    editPauseNote,
  } = useTestControls()

  if (!isAdmin) return null

  return (
    <div className="test-controls">
      {!active && (
        <button className="test-controls__btn" onClick={start} disabled={busy}>
          ● Testi Başlat
        </button>
      )}
      {active && (
        <>
          <button className="test-controls__btn test-controls__btn--active" onClick={stop} disabled={busy}>
            ⏹️ Testi Durdur
          </button>
          <button className="test-controls__btn test-controls__btn--pause" onClick={togglePause} disabled={busy}>
            {paused ? '▶️ Devam' : '⏸ Duraklat'}
          </button>
          {paused && (
            <button className="test-controls__btn" onClick={editPauseNote} disabled={busy}>Duraklama notu</button>
          )}
          <span className={`test-controls__timer ${paused ? 'is-paused' : ''}`}>{elapsed}</span>
          <span className="test-control-context">{vehicleName}</span>
        </>
      )}
      {error && <span className="test-ui-error" role="alert">{error}</span>}
    </div>
  )
}
