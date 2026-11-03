import { ScoreIndex, daysLate, formatAverage, formatDaysLate, formatDueDate, formatGrade, formatNumber, stemAveragesForStudent, toPowerSchoolGrade } from '@shared/grading'
import type { GradebookAssignment, StudentDashboard } from '@shared/types'
import type { Navigate } from '../App'
import { errorMessage, getAssignmentOrder, sortAssignments } from '../hooks'
import { useStatus } from './Status'

const marked = (assignments: GradebookAssignment[], idx: ScoreIndex, studentId: number, mark: 'M' | 'E'): GradebookAssignment[] =>
  assignments.filter((a) => idx.get(studentId, a.id) === mark)

function MarkedList({ title, note, cls, items }: { title: string; note: string; cls: string; items: GradebookAssignment[] }) {
  if (items.length === 0) return null
  return (
    <>
      <h4>{title} ({items.length}) <span className="muted small">{note}</span></h4>
      <ul className={`mark-list ${cls}`}>{items.map((a) => <li key={a.id}>{a.name} <span className="muted small">due {formatDueDate(a.dueDate)}</span></li>)}</ul>
    </>
  )
}

/** Late assignments, each with an optional submitted date that drives the "X days late" count. */
function LateList({ items, idx, studentId, editable, onChanged }: {
  items: GradebookAssignment[]
  idx: ScoreIndex
  studentId: number
  editable: boolean
  onChanged: () => Promise<void>
}) {
  const status = useStatus()
  if (items.length === 0) return null
  const save = (assignmentId: number, submittedDate: string | null) =>
    status.track(window.api.setSubmittedDate({ assignmentId, studentId, submittedDate }).then(onChanged)).catch((e: unknown) => status.fail(errorMessage(e)))
  return (
    <>
      <h4>Late assignments ({items.length}) <span className="muted small">Scored as handed in. Add the date submitted to see how late.</span></h4>
      <ul className="mark-list is-late">
        {items.map((a) => {
          const submitted = idx.submittedDate(studentId, a.id)
          const late = submitted ? formatDaysLate(daysLate(a.dueDate, submitted)) : ''
          return (
            <li key={a.id}>
              <div className="late-row">
                <span>{a.name} <span className="muted small">due {formatDueDate(a.dueDate)}</span></span>
                <label className="small">
                  Submitted{' '}
                  <input
                    type="date"
                    value={submitted ?? ''}
                    min={a.dueDate}
                    disabled={!editable}
                    aria-label={`Date submitted: ${a.name}`}
                    onChange={(e) => e.target.value !== (submitted ?? '') && void save(a.id, e.target.value || null)}
                  />
                </label>
                {late && <strong>{late}</strong>}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Grades for every course the student is or was in. Uses the same grading functions as the gradebook. Only late submission dates can be edited here. */
export function StudentGrades({ dashboard, navigate, onChanged }: { dashboard: StudentDashboard; navigate: Navigate; onChanged: () => Promise<void> }) {
  const studentId = dashboard.student.id
  const order = getAssignmentOrder()
  if (dashboard.courses.length === 0) {
    return <p className="muted">Not enrolled in any course yet.</p>
  }
  return (
    <>
      {dashboard.courses.map((c) => {
        const assignments = sortAssignments(c.assignments, order)
        const idx = new ScoreIndex(c.scores)
        const avgs = stemAveragesForStudent(assignments, c.stems.map((s) => s.id), (aid) => idx.get(studentId, aid))
        const historical = c.course.archived || !c.enrollmentActive
        return (
          <section key={c.course.id} className={historical ? 'panel course-block historical' : 'panel course-block'}>
            <div className="panel-head">
              <h3>
                {c.course.name} <span className="muted small">{c.course.subjectName}</span>
              </h3>
              <div>
                {c.course.archived && <span className="badge">Archived course</span>}
                {!c.enrollmentActive && <span className="badge">No longer enrolled</span>}
                <button className="link" onClick={() => navigate('gradebooks', { courseId: c.course.id })}>Open gradebook</button>
              </div>
            </div>
            {assignments.length === 0 ? (
              <p className="muted">No assignments in this course yet.</p>
            ) : (
              <table className="list-table compact">
                <thead><tr><th>Assignment</th><th>Due</th><th>Score</th><th>PowerSchool grade</th></tr></thead>
                <tbody>
                  {assignments.map((a) => {
                    const score = idx.get(studentId, a.id)
                    const grade = toPowerSchoolGrade(score, a.maxPoints)
                    return (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{formatDueDate(a.dueDate)}</td>
                        <td>
                          {score === null ? <span className="muted">Not yet graded</span>
                            : score === 'M' ? <span className="is-missing mark-tag">Missing</span>
                            : score === 'E' ? <span className="is-exempt mark-tag">Exempt</span>
                            : <>{formatNumber(score)} / {formatNumber(a.maxPoints)}{idx.isLate(studentId, a.id) && <> <span className="is-late mark-tag">Late</span></>}</>}
                        </td>
                        <td className={grade ? `value-cell g${grade}` : 'value-cell'}>{formatGrade(grade)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <MarkedList title="Missing assignments" note="Counted as 0 in the averages below." cls="is-missing" items={marked(assignments, idx, studentId, 'M')} />
            <LateList items={assignments.filter((a) => idx.isLate(studentId, a.id))} idx={idx} studentId={studentId} editable={!c.course.archived} onChanged={onChanged} />
            <MarkedList title="Exempt assignments" note="Excluded from the averages below." cls="is-exempt" items={marked(assignments, idx, studentId, 'E')} />
            <h4>Weighted stem averages</h4>
            <table className="list-table compact stem-table">
              <thead><tr>{c.stems.map((s) => <th key={s.id}>{s.name}{!s.active && ' (inactive)'}</th>)}</tr></thead>
              <tbody><tr>{c.stems.map((s) => <td key={s.id} className="value-cell">{formatAverage(avgs.get(s.id) ?? null) || '—'}</td>)}</tr></tbody>
            </table>
          </section>
        )
      })}
    </>
  )
}
