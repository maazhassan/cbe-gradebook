import { useState } from 'react'
import type { LogEntry } from '@shared/types'
import { LogEntryDialog } from './LogEntryDialog'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Log entries, newest first. `onStudent` turns the student name into a link (omit it on a student's own dashboard). */
export function LogEntryList(props: { entries: LogEntry[]; empty: string; onToggleArchive: (e: LogEntry) => void; onChanged: () => void; onStudent?: (id: number) => void }) {
  const { entries, empty, onToggleArchive, onChanged, onStudent } = props
  const [editing, setEditing] = useState<LogEntry | null>(null)
  if (entries.length === 0) return <p className="muted">{empty}</p>
  return (
    <>
    <ul className="log-list">
      {entries.map((e) => (
        <li key={e.id} className="log-entry">
          <div className="log-head">
            <strong>{e.title}</strong>
            <span>
              <button onClick={() => setEditing(e)}>Edit</button>{' '}
              <button onClick={() => onToggleArchive(e)}>{e.archived ? 'Unarchive' : 'Archive'}</button>
            </span>
          </div>
          <div className="muted small">
            {onStudent && (
              <>
                <button className="link" onClick={() => onStudent(e.studentId)}>{e.studentFirstName} {e.studentLastName}</button>
                {' · '}
              </>
            )}
            {when(e.createdAt)}
          </div>
          {e.body && <p className="log-body">{e.body}</p>}
        </li>
      ))}
    </ul>
    {editing && <LogEntryDialog key={editing.id} entry={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </>
  )
}
