import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { User } from '../types/auth'
import * as authApi from '../api/auth'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, displayName: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount: check for stored token and validate
  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('access_token')
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const res = await authApi.getMe()
        setUser(res.user)
      } catch {
        // Try refresh
        const refresh = localStorage.getItem('refresh_token')
        if (refresh) {
          try {
            const res = await authApi.refreshToken(refresh)
            localStorage.setItem('access_token', res.access_token)
            const me = await authApi.getMe()
            setUser(me.user)
          } catch {
            localStorage.removeItem('access_token')
            localStorage.removeItem('refresh_token')
          }
        } else {
          localStorage.removeItem('access_token')
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password)
    localStorage.setItem('access_token', res.access_token)
    localStorage.setItem('refresh_token', res.refresh_token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (username: string, displayName: string, password: string) => {
    const res = await authApi.register(username, displayName, password)
    localStorage.setItem('access_token', res.access_token)
    localStorage.setItem('refresh_token', res.refresh_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const res = await authApi.getMe()
    setUser(res.user)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
