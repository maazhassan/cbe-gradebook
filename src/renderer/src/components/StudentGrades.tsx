import { ScoreIndex, formatAverage, formatGrade, formatNumber, stemAveragesForStudent, toPowerSchoolGrade } from '@shared/grading'
import type { StudentDashboard } from '@shared/types'
import type { Navigate } from '../App'

/** Read-only grades for every course the student is or was in. Uses the same grading functions as the gradebook. */
export function StudentGrades({ dashboard, navigate }: { dashboard: StudentDashboard; navigate: Navigate }) {
  const studentId = dashboard.student.id
  if (dashboard.courses.length === 0) {
    return <p className="muted">Not enrolled in any course yet.</p>
  }
  return (
    <>
      {dashboard.courses.map((c) => {
        const idx = new ScoreIndex(c.scores)
        const avgs = stemAveragesForStudent(c.assignments, c.stems.map((s) => s.id), (aid) => idx.get(studentId, aid))
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
            {c.assignments.length === 0 ? (
              <p className="muted">No assignments in this course yet.</p>
            ) : (
              <table className="list-table compact">
                <thead><tr><th>Assignment</th><th>Score</th><th>PowerSchool grade</th></tr></thead>
                <tbody>
                  {c.assignments.map((a) => {
                    const score = idx.get(studentId, a.id)
                    const grade = toPowerSchoolGrade(score, a.maxPoints)
                    return (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{score === null ? <span className="muted">Not yet graded</span> : `${formatNumber(score)} / ${formatNumber(a.maxPoints)}`}</td>
                        <td className={grade ? `value-cell g${grade}` : 'value-cell'}>{formatGrade(grade)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
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
