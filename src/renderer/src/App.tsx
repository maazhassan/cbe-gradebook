import { useState } from 'react'
import { ConfirmProvider } from './components/Modal'
import { StatusProvider } from './components/Status'
import { CoursesPage } from './pages/CoursesPage'
import { GradebookPage } from './pages/GradebookPage'
import { SettingsPage } from './pages/SettingsPage'
import { StudentsPage } from './pages/StudentsPage'

export type Page = 'gradebooks' | 'students' | 'courses' | 'settings'
export interface Navigate {
  (page: Page, target?: { courseId?: number; studentId?: number }): void
}

const NAV: { page: Page; label: string }[] = [
  { page: 'gradebooks', label: 'Gradebooks' },
  { page: 'students', label: 'Students' },
  { page: 'courses', label: 'Courses' },
  { page: 'settings', label: 'Settings / Backups' }
]

export function App() {
  const [page, setPage] = useState<Page>('gradebooks')
  const [target, setTarget] = useState<{ courseId?: number; studentId?: number }>({})
  const navigate: Navigate = (p, t = {}) => {
    setTarget(t)
    setPage(p)
  }
  return (
    <StatusProvider>
      <ConfirmProvider>
        <div className="shell">
          <nav className="sidebar" aria-label="Main">
            <div className="brand">CBE Gradebook</div>
            {NAV.map((n) => (
              <button
                key={n.page}
                className={page === n.page ? 'nav-item active' : 'nav-item'}
                aria-current={page === n.page ? 'page' : undefined}
                onClick={() => navigate(n.page)}
              >
                {n.label}
              </button>
            ))}
            <div className="sidebar-foot">Data stays on this computer.</div>
          </nav>
          <main className="content">
            {page === 'gradebooks' && <GradebookPage initialCourseId={target.courseId} navigate={navigate} />}
            {page === 'students' && <StudentsPage initialStudentId={target.studentId} navigate={navigate} />}
            {page === 'courses' && <CoursesPage navigate={navigate} />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </div>
      </ConfirmProvider>
    </StatusProvider>
  )
}
