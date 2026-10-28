import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Course, LogEntry, Student } from '@shared/types'
import type { Navigate } from '../App'
import { LogEntryList } from '../components/LogEntryList'
import { CommentsEditor } from '../components/CommentsEditor'
import { Modal, useConfirm } from '../components/Modal'
import { RosterImport } from '../components/RosterImport'
import { useStatus } from '../components/Status'
import { StudentGrades } from '../components/StudentGrades'
import { errorMessage, useLoad } from '../hooks'

function StudentDialog(props: { student: Student | null; courses: Course[]; onClose: () => void; onSaved: (id: number) => void }) {
  const { student, courses, onClose, onSaved } = props
  const [first, setFirst] = useState(student?.firstName ?? '')
  const [last, setLast] = useState(student?.lastName ?? '')
  const [courseIds, setCourseIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!first.trim() || !last.trim()) return setError('Enter both a first and last name.')
    try {
      const saved = student
        ? await window.api.updateStudent({ id: student.id, firstName: first, lastName: last })
        : await window.api.createStudent({ firstName: first, lastName: last, courseIds })
      onSaved(saved.id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Modal title={student ? 'Edit student' : 'Add student'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>First name</span><input spellCheck={false} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus /></label>
        <label className="field"><span>Last name</span><input spellCheck={false} value={last} onChange={(e) => setLast(e.target.value)} /></label>
        {!student && (
          <fieldset className="field">
            <legend>Enrol in courses</legend>
            <div className="checks">
              {courses.filter((c) => !c.archived).map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={courseIds.includes(c.id)} onChange={(e) => setCourseIds(e.target.checked ? [...courseIds, c.id] : courseIds.filter((x) => x !== c.id))} />
                  {c.name}
                </label>
              ))}
              {courses.every((c) => c.archived) && <span className="muted">No active courses yet.</span>}
            </div>
          </fieldset>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">{student ? 'Save' : 'Add student'}</button>
        </div>
      </form>
    </Modal>
  )
}

function StudentDetail(props: { id: number; courses: Course[]; navigate: Navigate; onChanged: () => void }) {
  const { id, courses, navigate, onChanged } = props
  const dash = useLoad(() => window.api.getStudentDashboard(id), [id])
  const confirm = useConfirm()
  const status = useStatus()
  const logs = useLoad(() => window.api.listLogEntries({ archived: false, studentId: id }), [id])
  const [editing, setEditing] = useState(false)

  if (dash.error) return <p className="field-error" role="alert">{dash.error}</p>
  if (!dash.data) return <p className="muted">Loading…</p>
  const { student } = dash.data

  const refresh = async () => {
    await dash.reload()
    onChanged()
  }

  const toggleArchive = async () => {
    if (!student.archived) {
      const ok = await confirm({
        title: 'Archive student?',
        message: `${student.firstName} ${student.lastName} will leave active class lists. Their grades, comments and course history are kept and you can reactivate them later.`,
        confirmLabel: 'Archive'
      })
      if (!ok) return
    }
    try {
      await status.track(window.api.setStudentArchived({ id, archived: !student.archived }))
      await refresh()
    } catch { /* shown in status area */ }
  }

  const archiveLog = async (entry: LogEntry) => {
    try {
      await status.track(window.api.setLogEntryArchived({ id: entry.id, archived: true }))
      await logs.reload()
    } catch { /* shown in status area */ }
  }

  const setEnrolled = async (course: Course, active: boolean) => {
    if (!active) {
      const ok = await confirm({
        title: 'Remove from course?',
        message: `${student.firstName} will no longer appear in ${course.name}'s active roster. Their existing scores are kept as history.`,
        confirmLabel: 'Remove'
      })
      if (!ok) return
    }
    try {
      await status.track(window.api.setEnrollment({ studentId: id, courseId: course.id, active }))
      await refresh()
    } catch { /* shown in status area */ }
  }

  const activeEnrolled = new Set(student.enrollments.filter((e) => e.active).map((e) => e.courseId))
  const history = student.enrollments.filter((e) => !e.active || e.courseArchived)

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{student.firstName} {student.lastName}</h2>
          {student.archived && <span className="badge">Archived</span>}
        </div>
        <div className="head-actions">
          <button onClick={() => setEditing(true)}>Edit name</button>
          <button onClick={() => void toggleArchive()}>{student.archived ? 'Reactivate' : 'Archive'}</button>
        </div>
      </header>

      <CommentsEditor key={student.id} studentId={student.id} initial={student} />

      <section className="panel" aria-labelledby="enrol-h">
        <div className="panel-head"><h2 id="enrol-h">Courses</h2></div>
        {courses.filter((c) => !c.archived).length === 0 && <p className="muted">No active courses.</p>}
        <div className="checks">
          {courses.filter((c) => !c.archived).map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={activeEnrolled.has(c.id)} disabled={student.archived && !activeEnrolled.has(c.id)} onChange={(e) => void setEnrolled(c, e.target.checked)} />
              {c.name} <span className="muted small">{c.subjectName}</span>
            </label>
          ))}
        </div>
        {history.length > 0 && (
          <p className="hint">History: {history.map((h) => `${h.courseName} (${h.courseArchived ? 'archived course' : 'not enrolled'})`).join('; ')}.</p>
        )}
      </section>

      <h2 className="section-title">Grades <span className="muted small">read-only · enter scores in each course’s Raw Scores tab</span></h2>
      <StudentGrades dashboard={dash.data} navigate={navigate} />

      <section className="panel" aria-labelledby="logs-h">
        <div className="panel-head">
          <h2 id="logs-h">Log entries</h2>
          <button className="link" onClick={() => navigate('logs')}>Add or manage entries</button>
        </div>
        {logs.error && <p className="field-error" role="alert">{logs.error}</p>}
        {logs.data && <LogEntryList entries={logs.data} empty="No log entries for this student." onToggleArchive={(e) => void archiveLog(e)} onChanged={() => void logs.reload()} />}
      </section>

      {editing && (
        <StudentDialog student={student} courses={courses} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refresh() }} />
      )}
    </div>
  )
}

export function StudentsPage({ initialStudentId, navigate }: { initialStudentId?: number; navigate: Navigate }) {
  const students = useLoad(() => window.api.listStudents(), [])
  const courses = useLoad(() => window.api.listCourses(), [])
  const [selected, setSelected] = useState<number | null>(initialStudentId ?? null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const q = search.trim().toLowerCase()
  const visible = (students.data ?? []).filter(
    (s) => (showArchived || !s.archived) && `${s.firstName} ${s.lastName} ${s.lastName}, ${s.firstName}`.toLowerCase().includes(q)
  )

  return (
    <div className="students">
      <aside className="student-list">
        <header className="page-head tight">
          <h1>Students</h1>
        </header>
        <div className="head-actions wrap">
          <button className="primary" onClick={() => setAdding(true)}>Add student</button>
          <button onClick={() => setImporting(true)}>Import CSV</button>
        </div>
        <input type="search" placeholder="Search students" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        {students.error && <p className="field-error" role="alert">{students.error}</p>}
        <ul className="names" aria-label="Students">
          {visible.map((s) => (
            <li key={s.id}>
              <button className={s.id === selected ? 'name-row active' : 'name-row'} aria-current={s.id === selected} onClick={() => setSelected(s.id)}>
                <span>{s.lastName}, {s.firstName}</span>
                {s.archived && <span className="badge">Archived</span>}
              </button>
            </li>
          ))}
          {students.data && visible.length === 0 && <li className="muted pad">{students.data.length === 0 ? 'No students yet.' : 'No students match.'}</li>}
        </ul>
      </aside>
      <section className="student-detail">
        {selected === null ? (
          <div className="empty"><p>Select a student to see their dashboard, or add one.</p></div>
        ) : (
          <StudentDetail key={selected} id={selected} courses={courses.data ?? []} navigate={navigate} onChanged={() => void students.reload()} />
        )}
      </section>
      {adding && (
        <StudentDialog
          student={null}
          courses={courses.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={(id) => { setAdding(false); setSelected(id); void students.reload(); void courses.reload() }}
        />
      )}
      {importing && (
        <RosterImport
          courses={courses.data ?? []}
          students={students.data ?? []}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); void students.reload(); void courses.reload() }}
        />
      )}
    </div>
  )
}
