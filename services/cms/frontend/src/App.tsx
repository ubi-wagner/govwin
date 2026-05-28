import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import EmailAccounts from './pages/EmailAccounts'
import EmailCampaigns from './pages/EmailCampaigns'
import EmailOutbox from './pages/EmailOutbox'
import ContentPipeline from './pages/ContentPipeline'
import ContentEditor from './pages/ContentEditor'
import ContentPreview from './pages/ContentPreview'
import ContentGenerations from './pages/ContentGenerations'
import DripCampaigns from './pages/DripCampaigns'
import SocialAccounts from './pages/SocialAccounts'
import SocialPosts from './pages/SocialPosts'
import Todos from './pages/Todos'
import Login from './pages/Login'

interface User {
  id: string
  email: string
  name: string
  role: string
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Check for existing session on mount
    fetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated')
        return res.json()
      })
      .then((json) => {
        if (json.data) setUser(json.data)
      })
      .catch(() => {
        // Not authenticated — stay on login
      })
      .finally(() => setChecking(false))
  }, [])

  function handleLogin(u: User) {
    setUser(u)
  }

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {
        // best-effort
      })
      .finally(() => setUser(null))
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <BrowserRouter basename="/cms">
      <Routes>
        <Route element={<Layout user={user} onLogout={handleLogout} />}>
          <Route index element={<Dashboard />} />
          <Route path="email/accounts" element={<EmailAccounts />} />
          <Route path="email/campaigns" element={<EmailCampaigns />} />
          <Route path="email/outbox" element={<EmailOutbox />} />
          <Route path="content" element={<ContentPipeline />} />
          <Route path="content/generations" element={<ContentGenerations />} />
          <Route path="content/new" element={<ContentEditor />} />
          <Route path="content/:id/edit" element={<ContentEditor />} />
          <Route path="content/:id/preview" element={<ContentPreview />} />
          <Route path="drip" element={<DripCampaigns />} />
          <Route path="social/accounts" element={<SocialAccounts />} />
          <Route path="social/posts" element={<SocialPosts />} />
          <Route path="todos" element={<Todos />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
