import { useEffect, useRef, useState } from 'react'
import {
  ScoreIndex, formatAverage, formatGrade, formatNumber, parseScoreInput, stemAveragesForStudent, toPowerSchoolGrade
} from '@shared/grading'
import type { CourseGradebook, GradebookAssignment } from '@shared/types'

const fullName = (s: { firstName: string; lastName: string }): string => `${s.lastName}, ${s.firstName}`

function AssignmentHeader({ gb, a, onEdit }: { gb: CourseGradebook; a: GradebookAssignment; onEdit?: (a: GradebookAssignment) => void }) {
  const stems = a.stemIds.map((id) => gb.stems.find((s) => s.id === id)?.name).filter((n): n is string => !!n)
  const summary = `${a.name}. Maximum ${formatNumber(a.maxPoints)} points, weight ${a.weight}. Stems: ${stems.join(', ') || 'none'}.`
  return (
    <th scope="col" className="assignment-col" title={summary}>
      {onEdit ? (
        <button className="header-name" onClick={() => onEdit(a)} aria-label={`Edit assignment ${a.name}`}>
          {a.name}
        </button>
      ) : (
        <span className="header-name">{a.name}</span>
      )}
      <span className="header-meta" title="Maximum points · weight (relative importance)">
        /{formatNumber(a.maxPoints)} · ×{a.weight}
      </span>
      <span className="header-stems">
        {stems.length ? stems.map((s) => <span key={s} className="chip">{s}</span>) : <span className="muted small">no stems</span>}
      </span>
    </th>
  )
}

function ScoreCell(props: {
  value: number | null
  max: number
  label: string
  row: number
  col: number
  readOnly: boolean
  onCommit: (value: number | null) => Promise<void>
}) {
  const { value, max, label, row, col, readOnly, onCommit } = props
  const text = (v: number | null) => (v === null ? '' : formatNumber(v))
  const [draft, setDraft] = useState(text(value))
  const [error, setError] = useState<string | null>(null)
  const saved = useRef(value)

  useEffect(() => {
    saved.current = value
    setDraft(text(value))
    setError(null)
  }, [value])

  const commit = async (): Promise<boolean> => {
    const parsed = parseScoreInput(draft, max)
    if (!parsed.ok) {
      setError(parsed.error)
      return false
    }
    setError(null)
    if (parsed.value === saved.current) {
      setDraft(text(parsed.value))
      return true
    }
    const previous = saved.current
    saved.current = parsed.value
    try {
      await onCommit(parsed.value)
      return true
    } catch (e) {
      saved.current = previous
      setError(e instanceof Error ? e.message : 'Could not save.')
      return false
    }
  }

  const focusCell = (r: number, c: number) =>
    document.querySelector<HTMLInputElement>(`input[data-cell="${r}-${c}"]`)?.focus()

  return (
    <td className={error ? 'score-cell has-error' : 'score-cell'}>
      <input
        data-cell={`${row}-${col}`}
        value={draft}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={readOnly}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit().then((ok) => ok && focusCell(row + 1, col))
          } else if (e.key === 'Escape') {
            setDraft(text(saved.current))
            setError(null)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            focusCell(row + 1, col)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            focusCell(row - 1, col)
          }
        }}
      />
      {error && <span className="cell-error" role="alert">{error}</span>}
    </td>
  )
}

export function RawScoresGrid(props: {
  gb: CourseGradebook
  readOnly: boolean
  onEditAssignment: (a: GradebookAssignment) => void
  onSetScore: (assignmentId: number, studentId: number, rawScore: number | null) => Promise<void>
}) {
  const { gb, readOnly, onEditAssignment, onSetScore } = props
  const idx = new ScoreIndex(gb.scores)
  return (
    <div className="grid-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th scope="col" className="student-col">Student</th>
            {gb.assignments.map((a) => (
              <AssignmentHeader key={a.id} gb={gb} a={a} onEdit={readOnly ? undefined : onEditAssignment} />
            ))}
          </tr>
        </thead>
        <tbody>
          {gb.students.map((s, r) => (
            <tr key={s.id}>
              <th scope="row" className="student-col">{fullName(s)}</th>
              {gb.assignments.map((a, c) => (
                <ScoreCell
                  key={a.id}
                  value={idx.get(s.id, a.id)}
                  max={a.maxPoints}
                  row={r}
                  col={c}
                  readOnly={readOnly}
                  label={`${fullName(s)}, ${a.name}, out of ${formatNumber(a.maxPoints)}`}
                  onCommit={(v) => onSetScore(a.id, s.id, v)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PowerSchoolGrid({ gb }: { gb: CourseGradebook }) {
  const idx = new ScoreIndex(gb.scores)
  return (
    <div className="grid-scroll">
      <table className="grid derived">
        <thead>
          <tr>
            <th scope="col" className="student-col">Student</th>
            {gb.assignments.map((a) => <AssignmentHeader key={a.id} gb={gb} a={a} />)}
          </tr>
        </thead>
        <tbody>
          {gb.students.map((s) => (
            <tr key={s.id}>
              <th scope="row" className="student-col">{fullName(s)}</th>
              {gb.assignments.map((a) => {
                const grade = toPowerSchoolGrade(idx.get(s.id, a.id), a.maxPoints)
                return (
                  <td key={a.id} className={grade ? `value-cell g${grade}` : 'value-cell'}>
                    {formatGrade(grade)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StemAveragesGrid({ gb }: { gb: CourseGradebook }) {
  const idx = new ScoreIndex(gb.scores)
  const stemIds = gb.stems.map((s) => s.id)
  return (
    <div className="grid-scroll">
      <table className="grid derived">
        <thead>
          <tr>
            <th scope="col" className="student-col">Student</th>
            {gb.stems.map((s) => (
              <th key={s.id} scope="col" className="stem-col" title={`Weighted average of PowerSchool grades for ${s.name}. Ungraded work is ignored.`}>
                {s.name}
                {!s.active && <span className="muted small"> (inactive)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gb.students.map((s) => {
            const avgs = stemAveragesForStudent(gb.assignments, stemIds, (aid) => idx.get(s.id, aid))
            return (
              <tr key={s.id}>
                <th scope="row" className="student-col">{fullName(s)}</th>
                {stemIds.map((id) => (
                  <td key={id} className="value-cell">{formatAverage(avgs.get(id) ?? null)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
