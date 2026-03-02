import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from '../contexts/AuthContext'

export default function Layout() {
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      document.title = `Your Financial Picture — ${user.display_name}`
    }
  }, [user])

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="ml-60 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
