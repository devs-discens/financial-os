import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const userNavItems = [
  { to: '/', label: 'Financial Picture', icon: '~' },
  { to: '/progress', label: 'Progress', icon: '^' },
  { to: '/plan', label: 'Your Adviser', icon: '>' },
]

const adminNavItems = [
  { to: '/admin/registry', label: 'Registry', icon: '#' },
  { to: '/admin/users', label: 'Users', icon: '&' },
  { to: '/admin/demo', label: 'Demo', icon: '!' },
  { to: '/admin/benchmarks', label: 'Benchmarks', icon: '%' },
  { to: '/admin/background', label: 'Background', icon: '~' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const initials = user
    ? user.display_name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = user?.role === 'admin' ? adminNavItems : userNavItems

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-60 flex-col bg-white border-r border-ws-border">
      <div className="px-5 py-6">
        <h1 className="text-lg font-extrabold tracking-tight text-ws-accent">Your Financial Picture</h1>
        <p className="mt-0.5 text-xs text-ws-muted">Powered by AI</p>
      </div>

      <div
        onClick={() => navigate('/settings')}
        className="mx-4 mb-4 flex items-center gap-3 rounded-lg bg-ws-surface px-3 py-2.5 cursor-pointer hover:bg-ws-border transition-colors"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ws-accent text-xs font-bold text-white">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{user?.display_name ?? 'Unknown'}</p>
          <p className="text-xs text-ws-muted truncate">{user?.username}</p>
        </div>
      </div>

      <nav className="flex-1 px-3">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-ws-accent text-white'
                  : 'text-ws-muted hover:bg-ws-surface hover:text-ws-text'
              }`
            }
          >
            <span className="font-mono text-xs">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-ws-border">
        <button
          onClick={handleLogout}
          className="w-full rounded-lg border border-ws-border px-3 py-1.5 text-xs text-ws-muted hover:text-ws-text hover:bg-ws-surface transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
