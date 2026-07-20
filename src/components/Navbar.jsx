import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Avatar from './ui/Avatar'
import Button from './ui/Button'
import Icon from './ui/Icon'

export default function Navbar() {
  const { profile, user, isSuperAdmin, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header
      className="flex h-14 items-center justify-between border-b border-border bg-sidebar px-4"
      data-testid="navbar"
    >
      <div className="flex items-center gap-6">
        <Link to="/" className="text-xl font-bold text-text" data-testid="navbar-home-link">
          work-<span className="text-accent">it</span>
        </Link>
        {isSuperAdmin && (
          <Link
            to="/admin"
            className="rounded-md px-2 py-1 text-sm text-status-purple hover:bg-surface-2"
            data-testid="navbar-admin-link"
          >
            ניהול ארגונים
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          title={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
          aria-label={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
          data-testid="theme-toggle"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <div className="flex items-center gap-2" data-testid="navbar-user">
          <Avatar name={profile?.full_name} email={user?.email} size={30} />
          <span className="hidden text-sm text-text-muted sm:inline">
            {profile?.full_name || user?.email}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="navbar-signout">
          יציאה
        </Button>
      </div>
    </header>
  )
}
