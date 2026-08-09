import { useEffect, useState } from 'react'
import RecordsModal from './RecordsModal'
import './HeaderNav.css'

// Urban panelinde yalnızca bu araçta kullanılan izleme sayfaları bulunur.
// 3D görünüm kaldırıldı; sektör oluşturma sistemi sunucuda kalır ancak Urban
// navigasyonunda gösterilmez.
const NAV = [
  { href: '/laps', label: '🏁 Tur Takip' },
  { href: '/race', label: '🏎️ Yarış İzle' },
  { href: '/play', label: '🎥 Test Oynat' },
]

export default function HeaderNav() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [modal, setModal] = useState(null) // 'test' | 'daily' | 'tubitak' | null

  useEffect(() => {
    fetch('/api/auth/check', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.authenticated && d.user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])

  const logout = async () => {
    setLoggingOut(true)
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      window.location.assign('/login')
    }
  }

  return (
    <nav className="header-nav">
      {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
        <a key={n.href} className="header-nav__btn" href={n.href}>{n.label}</a>
      ))}
      {/* Kayıt modalları yalnızca admin (indirme/silme içerir) */}
      {isAdmin && (
        <>
          <button className="header-nav__btn" onClick={() => setModal('test')}>🧪 Testler</button>
          <button className="header-nav__btn" onClick={() => setModal('daily')}>📅 Kayıtlar</button>
          <button className="header-nav__btn" onClick={() => setModal('tubitak')}>📊 TÜBİTAK</button>
        </>
      )}
      <button
        className="header-nav__btn header-nav__btn--logout"
        onClick={logout}
        disabled={loggingOut}
      >
        {loggingOut ? 'Çıkılıyor…' : '↪ Hesaptan Çık'}
      </button>
      {modal && <RecordsModal type={modal} onClose={() => setModal(null)} />}
    </nav>
  )
}
