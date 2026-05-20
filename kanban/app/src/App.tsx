import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import BoardsPage from './pages/BoardsPage'
import BoardPage from './pages/BoardPage'
import SessionsPage from './pages/SessionsPage'
import ResultsPage from './pages/ResultsPage'
import VotePage from './pages/VotePage'

export default function App() {
  return (
    <Routes>
      {/* Internal routes with sidebar layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<BoardsPage />} />
        <Route path="/boards/:id" element={<BoardPage />} />
        <Route path="/boards/:id/sessions" element={<SessionsPage />} />
        <Route path="/boards/:id/results" element={<ResultsPage />} />
      </Route>

      {/* Public voting page — standalone, no sidebar */}
      <Route path="/vote/:slug" element={<VotePage />} />
    </Routes>
  )
}
