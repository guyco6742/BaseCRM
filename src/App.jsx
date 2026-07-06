import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import OrgLayout from './components/OrgLayout'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import OrgHomePage from './pages/OrgHomePage'
import BoardsPage from './pages/BoardsPage'
import BoardPage from './pages/BoardPage'
import ClientsPage from './pages/ClientsPage'
import ClientPage from './pages/ClientPage'
import OrgSettingsPage from './pages/OrgSettingsPage'
import SendContractPage from './pages/SendContractPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      {/* ציבורי */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* מוגן */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />

        {/* מרחב הארגון — עם סרגל צד וקונטקסט ארגון */}
        <Route path="/org/:orgId" element={<OrgLayout />}>
          <Route index element={<OrgHomePage />} />
          <Route path="workspace/:wsId" element={<BoardsPage />} />
          <Route path="board/:boardId" element={<BoardPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:clientId" element={<ClientPage />} />
          <Route path="settings" element={<OrgSettingsPage />} />
          <Route path="send-contract" element={<SendContractPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
