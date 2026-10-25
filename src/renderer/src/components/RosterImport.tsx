import { useMemo, useState } from 'react'
import { nameKey, parseRosterCsv } from '@shared/csv'
import type { RosterParse } from '@shared/csv'
import type { Course, RosterAction, StudentListItem } from '@shared/types'
import { errorMessage } from '../hooks'
import { Modal } from './Modal'

// choice per CSV line: 'create' | 'skip' | `existing:<id>`
type Choice = string

interface Analysed {
  line: number
  firstName: string
  lastName: string
  error: string | null
  matches: StudentListItem[]
  duplicateInFile: boolean
}

export function RosterImport(props: {
  courses: Course[]
  students: StudentListItem[]
  onClose: () => void
  onDone: () => void
}) {
  const { courses, students, onClose, onDone } = props
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<RosterParse | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [courseIds, setCourseIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo<Analysed[]>(() => {
    if (!parsed) return []
    const byName = new Map<string, StudentListItem[]>()
    for (const s of students) byName.set(nameKey(s.firstName, s.lastName), [...(byName.get(nameKey(s.firstName, s.lastName)) ?? []), s])
    const seen = new Set<string>()
    return parsed.rows.map((r) => {
      const key = nameKey(r.firstName, r.lastName)
      const duplicateInFile = !r.error && seen.has(key)
      if (!r.error) seen.add(key)
      return { ...r, matches: r.error ? [] : byName.get(key) ?? [], duplicateInFile }
    })
  }, [parsed, students])

  const defaultChoice = (r: Analysed): Choice => (r.error ? 'skip' : r.matches.length || r.duplicateInFile ? 'skip' : 'create')
  const choiceFor = (r: Analysed): Choice => choices[r.line] ?? defaultChoice(r)

  const pick = async () => {
    setError(null)
    try {
      const file = await window.api.pickRosterFile()
      if (!file) return
      setFileName(file.name)
      setChoices({})
      setParsed(parseRosterCsv(file.text))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const actions = rows.flatMap((r): RosterAction[] => {
    const c = choiceFor(r)
    if (c === 'create') return [{ action: 'create', firstName: r.firstName, lastName: r.lastName }]
    if (c.startsWith('existing:')) return [{ action: 'existing', studentId: Number(c.slice(9)) }]
    return []
  })
  const skipped = rows.length - actions.length

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.importRoster({ rows: actions, courseIds })
      const invalid = rows.filter((x) => x.error).length
      setResult(
        `Created ${r.created} new student${r.created === 1 ? '' : 's'}, reused ${r.matchedExisting} existing. ` +
          `Skipped ${skipped} row${skipped === 1 ? '' : 's'}${invalid ? ` (${invalid} invalid)` : ''}.`
      )
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  if (result) {
    return (
      <Modal title="Import finished" onClose={onDone}>
        <p>{result}</p>
        <div className="form-actions"><button className="primary" onClick={onDone} autoFocus>Done</button></div>
      </Modal>
    )
  }

  return (
    <Modal title="Import roster from CSV" onClose={onClose} wide>
      <p className="hint">
        Format: a header row with <code>first_name,last_name</code> (extra columns are ignored), then one student per row.
        Nothing is merged by name automatically: rows matching an existing student are skipped unless you choose otherwise.
      </p>
      <div className="row">
        <button onClick={() => void pick()}>{fileName ? 'Choose a different file' : 'Choose CSV file…'}</button>
        {fileName && <span className="muted">{fileName}</span>}
      </div>
      {parsed?.fileError && <p className="field-error" role="alert">{parsed.fileError}</p>}
      {rows.length > 0 && (
        <>
          <div className="preview-scroll">
            <table className="list-table compact">
              <thead><tr><th>Line</th><th>First name</th><th>Last name</th><th>Review</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={r.error ? 'invalid' : ''}>
                    <td>{r.line}</td>
                    <td>{r.firstName}</td>
                    <td>{r.lastName}</td>
                    <td>
                      {r.error ?? (
                        <>
                          {r.matches.length > 0 && <span className="badge warn">Same name as existing student{r.matches.length > 1 ? 's' : ''}{r.matches.some((m) => m.archived) ? ' (incl. archived)' : ''}</span>}
                          {r.duplicateInFile && <span className="badge warn">Repeated in this file</span>}
                          {!r.matches.length && !r.duplicateInFile && <span className="muted">New</span>}
                        </>
                      )}
                    </td>
                    <td>
                      {r.error ? <span className="muted">Skipped</span> : (
                        <select value={choiceFor(r)} aria-label={`Action for line ${r.line}`} onChange={(e) => setChoices({ ...choices, [r.line]: e.target.value })}>
                          <option value="create">Create new student</option>
                          <option value="skip">Skip</option>
                          {r.matches.filter((m) => !m.archived).map((m) => (
                            <option key={m.id} value={`existing:${m.id}`}>Use existing: {m.firstName} {m.lastName} (#{m.id})</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset className="field">
            <legend>Enrol these students in</legend>
            <div className="checks">
              {courses.filter((c) => !c.archived).map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={courseIds.includes(c.id)} onChange={(e) => setCourseIds(e.target.checked ? [...courseIds, c.id] : courseIds.filter((x) => x !== c.id))} />
                  {c.name}
                </label>
              ))}
              {courses.every((c) => c.archived) && <span className="muted">No active courses. Students will be created without enrolment.</span>}
            </div>
          </fieldset>
          <p className="muted">{actions.length} to import, {skipped} skipped.</p>
        </>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || actions.length === 0} onClick={() => void run()}>Import {actions.length || ''} students</button>
      </div>
    </Modal>
  )
}
