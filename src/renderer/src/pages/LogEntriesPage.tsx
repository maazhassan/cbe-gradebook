import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LogEntry } from '@shared/types'
import type { Navigate } from '../App'
import { LogEntryList } from '../components/LogEntryList'
import { useStatus } from '../components/Status'
import { StudentPicker } from '../components/StudentPicker'
import { errorMessage, useLoad } from '../hooks'

export function LogEntriesPage({ navigate }: { navigate: Navigate }) {
  const status = useStatus()
  const students = useLoad(() => window.api.listStudents(), [])
  const [showArchived, setShowArchived] = useState(false)
  const entries = useLoad(() => window.api.listLogEntries({ archived: showArchived }), [showArchived])
  const [studentId, setStudentId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (studentId === null) return setError('Choose a student.')
    if (!title.trim()) return setError('Enter a title.')
    try {
      await status.track(window.api.createLogEntry({ studentId, title, body }))
      setTitle('')
      setBody('')
      setError(null)
      await entries.reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const toggleArchive = async (entry: LogEntry) => {
    try {
      await status.track(window.api.setLogEntryArchived({ id: entry.id, archived: !entry.archived }))
      await entries.reload()
    } catch { /* shown in status area */ }
  }

  return (
    <div className="log-page">
      <header className="page-head"><h1>Log Entries</h1></header>

      <section className="panel" aria-labelledby="new-log-h">
        <h2 id="new-log-h">New entry</h2>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="field"><span>Student</span><StudentPicker students={students.data ?? []} value={studentId} onChange={setStudentId} /></div>
          <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
          <label className="field"><span>Entry</span><textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="form-actions"><button type="submit" className="primary">Add entry</button></div>
        </form>
      </section>

      <section className="panel" aria-labelledby="log-list-h">
        <div className="panel-head">
          <h2 id="log-list-h">{showArchived ? 'Archived entries' : 'All entries'}</h2>
          <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived instead</label>
        </div>
        {entries.error && <p className="field-error" role="alert">{entries.error}</p>}
        {entries.data && (
          <LogEntryList
            entries={entries.data}
            empty={showArchived ? 'No archived entries.' : 'No log entries yet.'}
            onToggleArchive={(e) => void toggleArchive(e)}
            onStudent={(id) => navigate('students', { studentId: id })}
          />
        )}
      </section>
    </div>
  )
}
