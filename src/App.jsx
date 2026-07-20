import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import OrgLayout from './components/OrgLayout'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingSpinner from './components/ui/LoadingSpinner'

// עוטף תוכן-עמוד ב-ErrorBoundary ברמת הנתיב: קריסה של עמוד בודד נבלמת בגבול
// הזה (בתוך ה-shell/סרגל-הצד) במקום להריק את כל המעטפת. גבול ה-top-level
// ב-main.jsx נשאר כרשת-הביטחון החיצונית. instance נפרד נוצר לכל נתיב, כך
// שמעבר לנתיב אחר מאפס אוטומטית את מצב השגיאה.
const boundary = (el) => <ErrorBoundary>{el}</ErrorBoundary>

const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'))
const PayThanksPage = lazy(() => import('./pages/PayThanksPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const OrgHomePage = lazy(() => import('./pages/OrgHomePage'))
const BoardsPage = lazy(() => import('./pages/BoardsPage'))
const BoardPage = lazy(() => import('./pages/BoardPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ClientPage = lazy(() => import('./pages/ClientPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const OrgDashboardPage = lazy(() => import('./pages/OrgDashboardPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LoadingSpinner label="טוען..." /></div>}>
      <Routes>
      {/* ציבורי */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/pay/thanks" element={<PayThanksPage />} />

      {/* מוגן */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={boundary(<DashboardPage />)} />
        <Route path="/admin" element={boundary(<AdminPage />)} />

        {/* מרחב הארגון — עם סרגל צד וקונטקסט ארגון */}
        <Route path="/org/:orgId" element={<OrgLayout />}>
          <Route index element={boundary(<OrgHomePage />)} />
          <Route path="dashboard" element={boundary(<OrgDashboardPage />)} />
          <Route path="reports" element={boundary(<ReportsPage />)} />
          <Route path="workspace/:wsId" element={boundary(<BoardsPage />)} />
          <Route path="board/:boardId" element={boundary(<BoardPage />)} />
          <Route path="clients" element={boundary(<ClientsPage />)} />
          <Route path="clients/:clientId" element={boundary(<ClientPage />)} />
          <Route path="payments" element={boundary(<PaymentsPage />)} />
          <Route path="settings" element={boundary(<OrgSettingsPage />)} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  )
}
