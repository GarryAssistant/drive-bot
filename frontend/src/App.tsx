import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { LoginPage } from './pages/LoginPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { EntryPage } from './pages/EntryPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SharePage } from './pages/SharePage'
import { BottomNav } from './components/BottomNav'
import { useQuery } from '@tanstack/react-query'
import { goalsApi } from './lib/api'

function AuthenticatedApp() {
  const { data, isLoading } = useQuery({
    queryKey: ['active-goal'],
    queryFn: () => goalsApi.getActive().catch(() => null),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const hasGoal = !!data?.data?.goal

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col pb-20">
      <Routes>
        <Route path="/" element={hasGoal ? <DashboardPage /> : <Navigate to="/onboarding" />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/entry" element={<EntryPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      {hasGoal && <BottomNav />}
    </div>
  )
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return isAuthenticated ? <AuthenticatedApp /> : <LoginPage />
}
