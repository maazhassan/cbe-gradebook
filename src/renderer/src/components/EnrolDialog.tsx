import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Course, StudentListItem } from '@shared/types'
import { errorMessage, useLoad } from '../hooks'
import { Modal } from './Modal'

/** Add students to a course without leaving the gradebook: pick existing ones or create a new one. */
export function EnrolDialog({ course, onClose, onDone }: { course: Course; onClose: () => void; onDone: () => void }) {
  const students = useLoad(() => window.api.listStudents(), [])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const available = (students.data ?? []).filter(
    (s: StudentListItem) =>
      !s.archived && !s.activeCourseIds.includes(course.id) &&
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const addPicked = () => run(() => window.api.enrollStudents({ courseId: course.id, studentIds: picked }))
  const createNew = (e: FormEvent) => {
    e.preventDefault()
    if (!first.trim() || !last.trim()) return setError('Enter both a first and last name.')
    void run(() => window.api.createStudent({ firstName: first, lastName: last, courseIds: [course.id] }))
  }

  return (
    <Modal title={`Add students to ${course.name}`} onClose={onClose} wide>
      <div className="two-col">
        <section>
          <h3>Existing students</h3>
          <input type="search" placeholder="Search by name" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="pick-list" role="group" aria-label="Students not in this course">
            {available.length === 0 && <p className="muted">No other active students{search ? ' match.' : ' to add.'}</p>}
            {available.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(s.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))}
                />
                {s.lastName}, {s.firstName}
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy || picked.length === 0} onClick={addPicked}>
            Add {picked.length || ''} selected
          </button>
        </section>
        <form onSubmit={createNew} noValidate>
          <h3>New student</h3>
          <label className="field"><span>First name</span><input spellCheck={false} value={first} onChange={(e) => setFirst(e.target.value)} /></label>
          <label className="field"><span>Last name</span><input spellCheck={false} value={last} onChange={(e) => setLast(e.target.value)} /></label>
          <button type="submit" className="primary" disabled={busy}>Create and add</button>
        </form>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  )
}
