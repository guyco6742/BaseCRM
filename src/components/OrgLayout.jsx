import { Outlet, Navigate } from 'react-router-dom'
import { OrgProvider, useOrg } from '../context/OrgContext'
import Sidebar from './Sidebar'
import LoadingSpinner from './ui/LoadingSpinner'

function OrgShell() {
  const { loading, notFound, role } = useOrg()

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingSpinner label="טוען ארגון..." />
      </div>
    )
  }

  // לא נמצא, או שאין למשתמש הרשאה לארגון הזה
  if (notFound || role === null) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}

export default function OrgLayout() {
  return (
    <OrgProvider>
      <OrgShell />
    </OrgProvider>
  )
}
