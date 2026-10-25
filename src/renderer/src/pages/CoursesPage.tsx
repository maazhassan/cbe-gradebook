import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Course } from '@shared/types'
import type { Navigate } from '../App'
import { Modal, useConfirm } from '../components/Modal'
import { useStatus } from '../components/Status'
import { errorMessage, useLoad } from '../hooks'

function CourseDialog({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: () => void }) {
  const subjects = useLoad(() => window.api.listSubjects(), [])
  const stems = useLoad(() => window.api.listStems(), [])
  const [name, setName] = useState(course?.name ?? '')
  const [subjectId, setSubjectId] = useState<number | null>(course?.subjectId ?? null)
  const [error, setError] = useState<string | null>(null)
  const chosen = subjectId ?? subjects.data?.[0]?.id ?? null
  const preview = (stems.data ?? []).filter((s) => s.subjectId === chosen && s.active).map((s) => s.name)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Enter a course name.')
    if (chosen === null) return setError('Choose a subject.')
    try {
      if (course) await window.api.updateCourse({ id: course.id, name })
      else await window.api.createCourse({ name, subjectId: chosen })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title={course ? 'Edit course' : 'Add course'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>Course name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. ELA 8 – Block B" />
        </label>
        <label className="field">
          <span>Subject</span>
          <select value={chosen ?? ''} onChange={(e) => setSubjectId(Number(e.target.value))} disabled={!!course}>
            {(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {course ? <span className="hint">A course’s subject can’t be changed after it is created.</span> : null}
        </label>
        <p className="hint">Learning stems for this subject: {preview.join(', ') || 'none active'}.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">{course ? 'Save' : 'Add course'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function CoursesPage({ navigate }: { navigate: Navigate }) {
  const courses = useLoad(() => window.api.listCourses(), [])
  const confirm = useConfirm()
  const status = useStatus()
  const [editing, setEditing] = useState<Course | 'new' | null>(null)

  const toggleArchive = async (c: Course) => {
    if (!c.archived) {
      const ok = await confirm({
        title: 'Archive course?',
        message: `“${c.name}” will be hidden from the normal course list. Its students, scores and history are kept, and you can reactivate it any time.`,
        confirmLabel: 'Archive'
      })
      if (!ok) return
    }
    try {
      await status.track(window.api.setCourseArchived({ id: c.id, archived: !c.archived }))
      await courses.reload()
    } catch {
      /* shown by status area */
    }
  }

  return (
    <div>
      <header className="page-head">
        <h1>Courses</h1>
        <div className="head-actions"><button className="primary" onClick={() => setEditing('new')}>Add course</button></div>
      </header>
      {courses.error && <p className="field-error" role="alert">{courses.error}</p>}
      {courses.data && courses.data.length === 0 && (
        <div className="empty"><p>No courses yet. Add one, for example “ELA 8” or “Social Studies 8”.</p></div>
      )}
      {courses.data && courses.data.length > 0 && (
        <table className="list-table">
          <thead><tr><th>Course</th><th>Subject</th><th>Active students</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {courses.data.map((c) => (
              <tr key={c.id} className={c.archived ? 'archived' : ''}>
                <td>{c.name}</td>
                <td>{c.subjectName}</td>
                <td>{c.activeStudentCount}</td>
                <td>{c.archived ? <span className="badge">Archived</span> : 'Active'}</td>
                <td className="actions">
                  <button onClick={() => navigate('gradebooks', { courseId: c.id })}>Open gradebook</button>
                  <button onClick={() => setEditing(c)}>Edit</button>
                  <button onClick={() => void toggleArchive(c)}>{c.archived ? 'Reactivate' : 'Archive'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <CourseDialog
          course={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void courses.reload()
          }}
        />
      )}
    </div>
  )
}
