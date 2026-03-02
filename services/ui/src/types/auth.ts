export interface UserProfile {
  age: number
  occupation: string
  employer: string
  income: number
  city: string
  province: string
  relationship_status: string
  housing_status: string
  dependents: number
  financial_goals: string[]
}

export interface User {
  id: string
  username: string
  display_name: string
  role: string
  created_at?: string
  profile?: UserProfile
}

export interface AuthResponse {
  user: User
  access_token: string
  refresh_token: string
}
