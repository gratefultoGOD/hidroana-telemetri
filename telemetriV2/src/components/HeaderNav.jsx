import { useEffect, useState } from 'react'
import RecordsModal from './RecordsModal'
import './HeaderNav.css'

// Proto panelindeki (index.html) navigasyon butonlarının URBAN karşılığı.
// İzleme sayfaları (tur takip / yarış izle / test oynat / 3D) TÜM kullanıcılara
// açıktır — normal kullanıcılar yalnızca izler, müdahale edemez. "Sektör Oluştur"
// bir düzenleme aracı olduğundan yalnızca admin görür.
const NAV = [
  { href: '/laps', label: '🏁 Tur Takip' },
  { href: '/race', label: '🏎️ Yarış İzle' },
  { href: '/play', label: '🎥 Test Oynat' },
  { href: '/3dview', label: '🌍 3D Görünüm' },
  { href: '/sectors', label: '🏁 Sektör Oluştur', admin: true },
]

export default function HeaderNav() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [modal, setModal] = useState(null) // 'test' | 'daily' | 'tubitak' | null

  useEffect(() => {
    fetch('/api/auth/check', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.authenticated && d.user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])

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
      {modal && <RecordsModal type={modal} onClose={() => setModal(null)} />}
    </nav>
  )
}
