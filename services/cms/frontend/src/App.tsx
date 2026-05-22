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

export default function App() {
  return (
    <BrowserRouter basename="/cms">
      <Routes>
        <Route element={<Layout />}>
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
