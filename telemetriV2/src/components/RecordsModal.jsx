import { useCallback, useEffect, useState } from 'react'
import './HeaderNav.css'

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Her kayıt türü için başlık, liste ucu ve liste anahtarı.
// Günlük kayıtlar URBAN aracının kendi veri kümesinden (urban_data) okunur.
const CONFIG = {
  test: { title: '🧪 Test Kayıtları', listUrl: '/api/test/files', key: 'files', empty: 'Henüz test kaydı yok' },
  daily: { title: '📅 Günlük Kayıtlar (URBAN)', listUrl: '/api/urban-telemetry/days', key: 'days', empty: 'Henüz kayıt yok' },
  tubitak: { title: '📊 TÜBİTAK Kayıtları', listUrl: '/api/tubitak/files', key: 'files', empty: 'Henüz TÜBİTAK kaydı yok' },
}

export default function RecordsModal({ type, onClose }) {
  const cfg = CONFIG[type]
  const [items, setItems] = useState(null) // null = yükleniyor
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setItems(null)
    setError(false)
    fetch(cfg.listUrl, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setItems(d[cfg.key] || []))
      .catch(() => setError(true))
  }, [cfg.listUrl, cfg.key])

  useEffect(() => { load() }, [load])

  const go = (url) => { window.location.href = url }

  const del = (url, label) => {
    if (!window.confirm(`${label} silinecek. Emin misiniz?`)) return
    fetch(url, { method: 'DELETE', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { if (d.success) load(); else window.alert('Hata: ' + (d.error || '')) })
      .catch((e) => window.alert('Hata: ' + e.message))
  }

  const rename = (file) => {
    const cur = file.fileName.replace('.csv', '')
    const nn = window.prompt('Yeni dosya adını girin:', cur)
    if (nn === null || nn.trim() === '') return
    fetch('/api/test/rename/' + encodeURIComponent(file.fileName), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ newName: nn.trim() }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) load(); else window.alert('Hata: ' + d.error) })
      .catch((e) => window.alert('Bağlantı hatası: ' + e.message))
  }

  function renderRow(file, i) {
    const enc = encodeURIComponent(file.fileName)

    if (type === 'test') {
      return (
        <div className="rec-item" key={i}>
          <div className="rec-info">
            <span className="rec-title">
              {file.fileName.replace('.csv', '')}
              <span className={`rec-badge rec-badge--${file.vehicle}`}>{file.vehicle === 'urban' ? 'Urban' : 'Proto'}</span>
            </span>
            <span className="rec-sub">{file.dataCount} kayıt • {formatFileSize(file.fileSize)}</span>
          </div>
          <div className="rec-actions">
            <button className="rec-btn" onClick={() => rename(file)} title="Yeniden Adlandır">✏️</button>
            <button className="rec-btn" onClick={() => go(`/api/test/download/${enc}`)}>📥 CSV</button>
            <button className="rec-btn" onClick={() => go(`/api/test/download-xlsx/${enc}`)}>📊 Excel</button>
            <button className="rec-btn rec-btn--del" onClick={() => del(`/api/test/delete/${enc}`, `${file.date} ${file.time}`)}>🗑️</button>
          </div>
        </div>
      )
    }

    if (type === 'daily') {
      return (
        <div className="rec-item" key={i}>
          <div className="rec-info">
            <span className="rec-title">📅 {file.date}</span>
            <span className="rec-sub">{file.dataCount} kayıt • {formatFileSize(file.fileSize)}</span>
          </div>
          <div className="rec-actions">
            <button className="rec-btn" onClick={() => go(`/api/urban-telemetry/download/${enc}`)}>📥 CSV</button>
            <button className="rec-btn" onClick={() => go(`/api/urban-telemetry/download-xlsx/${enc}`)}>📊 Excel</button>
            <button className="rec-btn rec-btn--del" onClick={() => del(`/api/urban-telemetry/delete/${enc}`, file.date)}>🗑️</button>
          </div>
        </div>
      )
    }

    // tubitak
    return (
      <div className="rec-item" key={i}>
        <div className="rec-info">
          <span className="rec-title">📋 {file.date} {file.time}</span>
          <span className="rec-sub">{file.dataCount} kayıt • {formatFileSize(file.fileSize)}</span>
        </div>
        <div className="rec-actions">
          <button className="rec-btn" onClick={() => go(`/api/tubitak/download/${enc}`)}>📥 CSV</button>
          <button className="rec-btn rec-btn--del" onClick={() => del(`/api/tubitak/delete/${enc}`, `${file.date} ${file.time}`)}>🗑️</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rec-overlay" onClick={onClose}>
      <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rec-modal__header">
          <h2>{cfg.title}</h2>
          <button className="rec-modal__close" onClick={onClose} title="Kapat">×</button>
        </div>
        <div className="rec-modal__body">
          {items === null && !error && <p className="rec-muted">Yükleniyor...</p>}
          {error && <div className="rec-muted">❌ Yüklenirken hata oluştu</div>}
          {items && items.length === 0 && <div className="rec-muted">{cfg.empty}</div>}
          {items && items.length > 0 && items.map(renderRow)}
        </div>
        {type === 'daily' && (
          <div className="rec-modal__footer">
            <button className="rec-btn" onClick={() => go('/api/urban-telemetry/csv')}>📥 Tüm Veriler (CSV)</button>
            <button className="rec-btn" onClick={() => go('/api/urban-telemetry/xlsx')}>📊 Tümü (Excel)</button>
            <button className="rec-btn rec-btn--muted" onClick={onClose}>Kapat</button>
          </div>
        )}
      </div>
    </div>
  )
}
