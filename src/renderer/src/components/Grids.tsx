import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ScoreIndex, formatAverage, formatDueDate, formatGrade, formatNumber, formatScore, parseScoreInput, stemAveragesForStudent, toPowerSchoolGrade
} from '@shared/grading'
import { ResizeHandle, STUDENT_COL, assignmentCol, stemCol, useColumnWidths } from './ColumnResize'
import type { ColumnWidths } from './ColumnResize'
import type { AverageDecimals, Score } from '@shared/grading'
import type { CourseGradebook, GradebookAssignment } from '@shared/types'

const DEFAULT_STUDENT_WIDTH = 208
const DEFAULT_ASSIGNMENT_WIDTH = 136
const DEFAULT_STEM_WIDTH = 120

/** Fixed-layout column sizing so every column can be resized independently. */
function GridCols({ widths, cols }: { widths: ColumnWidths; cols: { key: string; fallback: number }[] }) {
  return (
    <colgroup>
      {cols.map((c) => <col key={c.key} style={{ width: widths.widthOf(c.key, c.fallback) }} />)}
    </colgroup>
  )
}

const tableWidth = (widths: ColumnWidths, cols: { key: string; fallback: number }[]): number =>
  cols.reduce((sum, c) => sum + widths.widthOf(c.key, c.fallback), 0)

function StudentHeader({ widths }: { widths: ColumnWidths }) {
  return (
    <th scope="col" className="student-col">
      Student
      <ResizeHandle colKey={STUDENT_COL} current={widths.widthOf(STUDENT_COL, DEFAULT_STUDENT_WIDTH)} widths={widths} label="Student" />
    </th>
  )
}

const assignmentCols = (gb: CourseGradebook) => [
  { key: STUDENT_COL, fallback: DEFAULT_STUDENT_WIDTH },
  ...gb.assignments.map((a) => ({ key: assignmentCol(a.id), fallback: DEFAULT_ASSIGNMENT_WIDTH }))
]

const fullName = (s: { firstName: string; lastName: string }): string => `${s.lastName}, ${s.firstName}`

/** Arming state for the "type this column into another app" macro, shared by both assignment grids. */
export interface MacroControls {
  armedKey: string | null
  onArm: (key: string, label: string, values: string[]) => void
  onCancel: () => void
}

/** What the macro types for a cell: the number, or MI (missing), EX (exempt), IN (blank). */
const macroValue = (score: Score | null, number: () => string): string =>
  score === null ? 'IN' : score === 'M' ? 'MI' : score === 'E' ? 'EX' : number()

function MacroButton({ macro, macroKey, label, values }: { macro: MacroControls; macroKey: string; label: string; values: () => string[] }) {
  const armed = macro.armedKey === macroKey
  return (
    <button
      className={armed ? 'macro-btn armed' : 'macro-btn'}
      aria-pressed={armed}
      onClick={() => (armed ? macro.onCancel() : macro.onArm(macroKey, label, values()))}
      title={armed ? 'Ready to type. Switch to the browser and press the hotkey. Click to cancel.' : 'Load this column, then type it into another app (e.g. PowerSchool) with a hotkey'}
    >
      {armed ? '● Armed' : '⌨ Type'}
    </button>
  )
}

function AssignmentHeader({ gb, a, empty, onEdit, widths, macro }: { gb: CourseGradebook; a: GradebookAssignment; empty?: number; onEdit?: (a: GradebookAssignment) => void; widths: ColumnWidths; macro?: ReactNode }) {
  const stems = a.stemIds.map((id) => gb.stems.find((s) => s.id === id)?.name).filter((n): n is string => !!n)
  const summary = `${a.name}. Maximum ${formatNumber(a.maxPoints)} points, weight ${a.weight}. Due ${formatDueDate(a.dueDate)}. Stems: ${stems.join(', ') || 'none'}.`
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
      <span className="header-meta" title="Due date">Due {formatDueDate(a.dueDate)}</span>
      {!!empty && (
        <span className="header-warn" title={`${empty} student${empty === 1 ? ' has' : 's have'} no grade entered. Enter a score, M (missing) or E (exempt).`}>
          ⚠ {empty} empty
        </span>
      )}
      <span className="header-stems">
        {stems.length ? stems.map((s) => <span key={s} className="chip">{s}</span>) : <span className="muted small">no stems</span>}
      </span>
      {macro}
      <ResizeHandle colKey={assignmentCol(a.id)} current={widths.widthOf(assignmentCol(a.id), DEFAULT_ASSIGNMENT_WIDTH)} widths={widths} label={a.name} />
    </th>
  )
}

const markClass = (v: Score | null): string => (v === null ? 'is-empty' : v === 'M' ? 'is-missing' : v === 'E' ? 'is-exempt' : '')

function ScoreCell(props: {
  value: Score | null
  max: number
  label: string
  row: number
  col: number
  readOnly: boolean
  onCommit: (value: Score | null) => Promise<void>
}) {
  const { value, max, label, row, col, readOnly, onCommit } = props
    const [draft, setDraft] = useState(formatScore(value))
  const [error, setError] = useState<string | null>(null)
  const saved = useRef(value)

  useEffect(() => {
    saved.current = value
    setDraft(formatScore(value))
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
      setDraft(formatScore(parsed.value))
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
    <td className={`score-cell ${markClass(value)}${error ? ' has-error' : ''}`}>
      <input
        data-cell={`${row}-${col}`}
        value={draft}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={readOnly}
        aria-label={value === null ? `${label} (empty)` : label}
        title={value === null ? 'No grade entered. Enter a score, M (missing) or E (exempt).' : value === 'M' ? 'Missing: counts as 0' : value === 'E' ? 'Exempt: excluded from grade' : undefined}
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
            setDraft(formatScore(saved.current))
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
  onSetScore: (assignmentId: number, studentId: number, rawScore: Score | null) => Promise<void>
  macro: MacroControls
}) {
  const { gb, readOnly, onEditAssignment, onSetScore, macro } = props
  const idx = new ScoreIndex(gb.scores)
  const widths = useColumnWidths()
  const cols = assignmentCols(gb)
  const emptyCount = (aid: number) => gb.students.filter((s) => idx.get(s.id, aid) === null).length
  return (
    <div className="grid-scroll">
      <table className="grid" style={{ width: tableWidth(widths, cols) }}>
        <GridCols widths={widths} cols={cols} />
        <thead>
          <tr>
            <StudentHeader widths={widths} />
            {gb.assignments.map((a) => (
              <AssignmentHeader
                key={a.id} gb={gb} a={a} empty={emptyCount(a.id)} widths={widths} onEdit={readOnly ? undefined : onEditAssignment}
                macro={
                  <MacroButton
                    macro={macro} macroKey={`raw-${a.id}`} label={`${a.name} (raw scores)`}
                    values={() => gb.students.map((s) => macroValue(idx.get(s.id, a.id), () => formatScore(idx.get(s.id, a.id))))}
                  />
                }
              />
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

export function PowerSchoolGrid({ gb, macro }: { gb: CourseGradebook; macro: MacroControls }) {
  const idx = new ScoreIndex(gb.scores)
  const widths = useColumnWidths()
  const cols = assignmentCols(gb)
  const emptyCount = (aid: number) => gb.students.filter((s) => idx.get(s.id, aid) === null).length
  return (
    <div className="grid-scroll">
      <table className="grid derived" style={{ width: tableWidth(widths, cols) }}>
        <GridCols widths={widths} cols={cols} />
        <thead>
          <tr>
            <StudentHeader widths={widths} />
            {gb.assignments.map((a) => (
              <AssignmentHeader
                key={a.id} gb={gb} a={a} empty={emptyCount(a.id)} widths={widths}
                macro={
                  <MacroButton
                    macro={macro} macroKey={`ps-${a.id}`} label={`${a.name} (PowerSchool grades)`}
                    values={() => gb.students.map((s) => {
                      const score = idx.get(s.id, a.id)
                      return macroValue(score, () => formatGrade(toPowerSchoolGrade(score, a.maxPoints)))
                    })}
                  />
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {gb.students.map((s) => (
            <tr key={s.id}>
              <th scope="row" className="student-col">{fullName(s)}</th>
              {gb.assignments.map((a) => {
                const score = idx.get(s.id, a.id)
                const grade = toPowerSchoolGrade(score, a.maxPoints)
                const cls = grade && score !== 'M' ? `value-cell g${grade}` : `value-cell ${markClass(score)}`
                return (
                  <td key={a.id} className={cls} title={score === null ? 'No grade entered' : score === 'M' ? 'Missing: counts as 0' : score === 'E' ? 'Exempt: excluded from grade' : undefined}>
                    {score === 'E' ? 'E' : score === 'M' ? '1 (M)' : formatGrade(grade)}
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

export function StemAveragesGrid({ gb, decimals }: { gb: CourseGradebook; decimals: AverageDecimals }) {
  const idx = new ScoreIndex(gb.scores)
  const stemIds = gb.stems.map((s) => s.id)
  const widths = useColumnWidths()
  const cols = [{ key: STUDENT_COL, fallback: DEFAULT_STUDENT_WIDTH }, ...stemIds.map((id) => ({ key: stemCol(id), fallback: DEFAULT_STEM_WIDTH }))]
  return (
    <div className="grid-scroll">
      <table className="grid derived" style={{ width: tableWidth(widths, cols) }}>
        <GridCols widths={widths} cols={cols} />
        <thead>
          <tr>
            <StudentHeader widths={widths} />
            {gb.stems.map((s) => (
              <th key={s.id} scope="col" className="stem-col" title={`Weighted average of PowerSchool grades for ${s.name}. Ungraded work is ignored.`}>
                {s.name}
                {!s.active && <span className="muted small"> (inactive)</span>}
                <ResizeHandle colKey={stemCol(s.id)} current={widths.widthOf(stemCol(s.id), DEFAULT_STEM_WIDTH)} widths={widths} label={s.name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gb.students.map((s) => {
            const avgs = stemAveragesForStudent(gb.assignments, stemIds, (aid) => idx.get(s.id, aid), decimals)
            return (
              <tr key={s.id}>
                <th scope="row" className="student-col">{fullName(s)}</th>
                {stemIds.map((id) => (
                  <td key={id} className="value-cell">{formatAverage(avgs.get(id) ?? null, decimals)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
