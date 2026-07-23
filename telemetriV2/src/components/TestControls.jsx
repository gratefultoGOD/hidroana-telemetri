import useTestControls from '../hooks/useTestControls'
import './TestControls.css'

export default function TestControls() {
  const {
    isAdmin,
    active,
    paused,
    elapsedFormatted,
    vehicleMismatch,
    busy,
    error,
    start,
    stop,
    togglePause,
  } = useTestControls()

  if (!isAdmin) return null

  const handleStop = () => {
    stop().then((result) => {
      if (result) {
        alert(`Test tamamlandı!\n\nDosya: ${result.testName}\nSüre: ${result.duration}\nKayıt: ${result.dataCount}`)
      }
    })
  }

  return (
    <div className="test-controls">
      {!active && (
        <button className="test-controls__btn" onClick={start} disabled={busy}>
          ● Testi Başlat
        </button>
      )}
      {active && (
        <>
          <button className="test-controls__btn test-controls__btn--active" onClick={handleStop} disabled={busy}>
            ⏹️ Testi Durdur
          </button>
          <button className="test-controls__btn test-controls__btn--pause" onClick={togglePause} disabled={busy}>
            {paused ? '▶️ Devam' : '⏸ Duraklat'}
          </button>
          <span className={`test-controls__timer ${paused ? 'is-paused' : ''}`}>{elapsedFormatted}</span>
          {vehicleMismatch && (
            <span className="test-controls__note" title="Proto panelinden başlatılan bir test kaydı sürüyor">
              (Proto testi)
            </span>
          )}
        </>
      )}
      {error && <span className="test-controls__error">{error}</span>}
    </div>
  )
}
