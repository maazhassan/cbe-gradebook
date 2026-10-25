import { ScoreIndex, formatAverage, formatDueDate, formatGrade, formatNumber, stemAveragesForStudent, toPowerSchoolGrade } from '@shared/grading'
import type { GradebookAssignment, StudentDashboard } from '@shared/types'
import type { Navigate } from '../App'
import { getAssignmentOrder, sortAssignments } from '../hooks'

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

/** Read-only grades for every course the student is or was in. Uses the same grading functions as the gradebook. */
export function StudentGrades({ dashboard, navigate }: { dashboard: StudentDashboard; navigate: Navigate }) {
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
                            : `${formatNumber(score)} / ${formatNumber(a.maxPoints)}`}
                        </td>
                        <td className={grade ? `value-cell g${grade}` : 'value-cell'}>{formatGrade(grade)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <MarkedList title="Missing assignments" note="Counted as 0 in the averages below." cls="is-missing" items={marked(assignments, idx, studentId, 'M')} />
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
