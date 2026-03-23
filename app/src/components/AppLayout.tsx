import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AiChat from './AiChat'

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-2">
      <div className="print:hidden flex flex-col self-stretch">
        <Sidebar />
      </div>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <AiChat />
    </div>
  )
}
