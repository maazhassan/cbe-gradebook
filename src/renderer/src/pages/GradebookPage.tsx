import { useEffect, useState } from 'react'
import { powerSchoolCsv, rawScoresCsv, stemAveragesCsv } from '@shared/export'
import type { GradebookAssignment } from '@shared/types'
import type { Navigate } from '../App'
import { AssignmentDialog } from '../components/AssignmentDialog'
import { EnrolDialog } from '../components/EnrolDialog'
import { PowerSchoolGrid, RawScoresGrid, StemAveragesGrid } from '../components/Grids'
import { useStatus } from '../components/Status'
import { errorMessage, useLoad } from '../hooks'

type Tab = 'raw' | 'ps' | 'stems'
const TABS: { id: Tab; label: string }[] = [
  { id: 'raw', label: 'Raw Scores' },
  { id: 'ps', label: 'PowerSchool Grades' },
  { id: 'stems', label: 'Weighted Stem Averages' }
]
const LAST_COURSE = 'gradebook.lastCourse'

export function GradebookPage({ initialCourseId, navigate }: { initialCourseId?: number; navigate: Navigate }) {
  const status = useStatus()
  const courses = useLoad(() => window.api.listCourses(), [])
  const [courseId, setCourseId] = useState<number | null>(initialCourseId ?? null)
  const [tab, setTab] = useState<Tab>('raw')
  const [editing, setEditing] = useState<GradebookAssignment | 'new' | null>(null)
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    const list = courses.data
    if (!list || list.length === 0) return
    if (courseId !== null && list.some((c) => c.id === courseId)) return
    const remembered = Number(localStorage.getItem(LAST_COURSE))
    const fallback = list.find((c) => c.id === remembered && !c.archived) ?? list.find((c) => !c.archived) ?? list[0]!
    setCourseId(fallback.id)
  }, [courses.data, courseId])

  useEffect(() => {
    if (courseId !== null) localStorage.setItem(LAST_COURSE, String(courseId))
  }, [courseId])

  const book = useLoad(
    () => (courseId === null ? Promise.resolve(null) : window.api.getGradebook(courseId)),
    [courseId]
  )

  if (courses.loading) return <p className="muted">Loading…</p>
  if (courses.error) return <p className="field-error" role="alert">{courses.error}</p>
  const list = courses.data ?? []
  if (list.length === 0) {
    return (
      <div className="empty">
        <h1>Gradebooks</h1>
        <p>Create your first course to start entering scores.</p>
        <button className="primary" onClick={() => navigate('courses')}>Go to Courses</button>
      </div>
    )
  }

  const gb = book.data
  const readOnly = !!gb?.course.archived

  const setScore = async (assignmentId: number, studentId: number, rawScore: number | null) => {
    await status.track(window.api.setRawScore({ assignmentId, studentId, rawScore }))
    book.setData((cur) => ({
      ...cur!,
      scores: [
        ...cur!.scores.filter((s) => !(s.assignmentId === assignmentId && s.studentId === studentId)),
        ...(rawScore === null ? [] : [{ assignmentId, studentId, rawScore }])
      ]
    }))
  }

  const exportCsv = async () => {
    if (!gb) return
    const make = { raw: rawScoresCsv, ps: powerSchoolCsv, stems: stemAveragesCsv }[tab]
    const suffix = { raw: 'raw-scores', ps: 'powerschool-grades', stems: 'stem-averages' }[tab]
    try {
      const r = await window.api.saveTextFile({ defaultName: `${gb.course.name}-${suffix}.csv`, content: make(gb) })
      if (r.saved) status.notify(`Exported to ${r.path}`)
    } catch (e) {
      status.fail(errorMessage(e))
    }
  }

  const closeAndReload = async () => {
    setEditing(null)
    setEnrolling(false)
    await Promise.all([book.reload(), courses.reload()])
  }

  return (
    <div className="gradebook">
      <header className="page-head">
        <div className="head-left">
          <h1>Gradebooks</h1>
          <label className="course-select">
            <span className="sr-only">Course</span>
            <select value={courseId ?? ''} onChange={(e) => setCourseId(Number(e.target.value))} aria-label="Course">
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.subjectName}{c.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="head-actions">
          <button onClick={() => void exportCsv()} disabled={!gb}>Export CSV</button>
          <button onClick={() => setEnrolling(true)} disabled={!gb || readOnly}>Add student</button>
          <button className="primary" onClick={() => setEditing('new')} disabled={!gb || readOnly}>Add assignment</button>
        </div>
      </header>

      <div role="tablist" aria-label="Gradebook views" className="tabs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'raw' && <p className="tab-note">Type raw scores here. This is the only place scores are entered. Enter saves and moves down; Esc cancels; leave blank for not yet graded.</p>}
      {tab === 'ps' && <p className="tab-note">Read-only. 90%+ = 4, 70%+ = 3, 50%+ = 2, below 50% = 1. Change scores on the Raw Scores tab.</p>}
      {tab === 'stems' && <p className="tab-note">Read-only. Weighted average of PowerSchool grades per stem (weights are relative); ungraded work is ignored and blank means nothing graded yet.</p>}
      {readOnly && <p className="banner">This course is archived, so it is read-only. Reactivate it in Courses to make changes.</p>}

      {book.error && <p className="field-error" role="alert">{book.error}</p>}
      {book.loading && !gb && <p className="muted">Loading…</p>}
      {gb && gb.students.length === 0 && (
        <div className="empty">
          <p>No active students in this course yet.</p>
          {!readOnly && <button className="primary" onClick={() => setEnrolling(true)}>Add students</button>}
        </div>
      )}
      {gb && gb.students.length > 0 && gb.assignments.length === 0 && tab !== 'stems' && (
        <div className="empty">
          <p>No assignments yet. Add one to start entering scores.</p>
          {!readOnly && <button className="primary" onClick={() => setEditing('new')}>Add assignment</button>}
        </div>
      )}
      {gb && gb.students.length > 0 && (gb.assignments.length > 0 || tab === 'stems') && (
        <>
          {tab === 'raw' && <RawScoresGrid gb={gb} readOnly={readOnly} onEditAssignment={setEditing} onSetScore={setScore} />}
          {tab === 'ps' && <PowerSchoolGrid gb={gb} />}
          {tab === 'stems' && <StemAveragesGrid gb={gb} />}
        </>
      )}

      {gb && editing && (
        <AssignmentDialog gb={gb} assignment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void closeAndReload()} />
      )}
      {gb && enrolling && <EnrolDialog course={gb.course} onClose={() => setEnrolling(false)} onDone={() => void closeAndReload()} />}
    </div>
  )
}
