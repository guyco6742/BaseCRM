import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import SetupNotice from './SetupNotice'

export default function Layout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SetupNotice />
      <Navbar />
      <main className="flex min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
