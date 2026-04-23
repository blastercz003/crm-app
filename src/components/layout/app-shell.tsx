import { Sidebar } from './sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: 'var(--app-bg)' }}>
      <Sidebar />
      <div
        className="flex-1 min-h-screen overflow-x-hidden"
        style={{ marginLeft: 'var(--sidebar-width)' }}
      >
        {children}
      </div>
    </div>
  )
}
