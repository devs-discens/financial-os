import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login, register } = useAuth()
  const navigate = useNavigate()

  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError('')
    try {
      if (isRegister) {
        await register(username, displayName || username, password)
      } else {
        await login(username, password)
      }
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ws-bg">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-ws-accent">Your Financial Picture</h1>
          <p className="mt-1 text-sm text-ws-muted">Powered by AI</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-white border border-ws-border p-6 space-y-4 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-center">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2.5 text-sm text-ws-text placeholder-ws-muted focus:outline-none focus:border-ws-accent"
              autoFocus
            />
            {isRegister && (
              <input
                type="text"
                placeholder="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2.5 text-sm text-ws-text placeholder-ws-muted focus:outline-none focus:border-ws-accent"
              />
            )}
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2.5 text-sm text-ws-text placeholder-ws-muted focus:outline-none focus:border-ws-accent"
            />
          </div>

          {error && <p className="text-sm text-ws-red">{error}</p>}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full rounded-lg bg-ws-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-ws-muted">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError('') }}
              className="text-ws-accent font-semibold hover:text-ws-accent-dim"
            >
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </p>
        </form>

        <p className="text-center text-xs text-ws-muted/60">
          Demo: alex-chen / password123
        </p>
      </div>
    </div>
  )
}
