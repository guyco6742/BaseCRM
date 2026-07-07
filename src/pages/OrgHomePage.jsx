import { Navigate } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import WorkspacesPage from './WorkspacesPage'

export default function OrgHomePage() {
  const { orgId, favorite, loading } = useOrg()

  if (loading) {
    return <LoadingSpinner label="טוען..." />
  }
  if (favorite?.type === 'board') {
    return <Navigate to={`/org/${orgId}/board/${favorite.boardId}`} replace />
  }
  if (favorite?.type === 'clients') {
    return <Navigate to={`/org/${orgId}/clients`} replace />
  }
  return <WorkspacesPage />
}
