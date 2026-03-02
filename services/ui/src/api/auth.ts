import { fetchJSON } from './client'
import type { AuthResponse, User } from '../types/auth'

export function login(username: string, password: string) {
  return fetchJSON<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function register(username: string, display_name: string, password: string) {
  return fetchJSON<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, display_name, password }),
  })
}

export function getMe() {
  return fetchJSON<{ user: User }>('/auth/me')
}

export function refreshToken(refresh_token: string) {
  return fetchJSON<{ access_token: string }>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token }),
  })
}

export function updateProfile(profile: Record<string, unknown>) {
  return fetchJSON<{ user: User }>('/auth/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })
}
