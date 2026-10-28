import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LogEntry } from '@shared/types'
import { errorMessage, useLoad } from '../hooks'
import { Modal } from './Modal'
import { useStatus } from './Status'
import { StudentPicker } from './StudentPicker'

export function LogEntryDialog({ entry, onClose, onSaved }: { entry: LogEntry; onClose: () => void; onSaved: () => void }) {
  const status = useStatus()
  const students = useLoad(() => window.api.listStudents(), [])
  const [studentId, setStudentId] = useState<number | null>(entry.studentId)
  const [title, setTitle] = useState(entry.title)
  const [body, setBody] = useState(entry.body)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (studentId === null) return setError('Choose a student.')
    if (!title.trim()) return setError('Enter a title.')
    try {
      await status.track(window.api.updateLogEntry({ id: entry.id, studentId, title, body }))
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title="Edit log entry" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="field"><span>Student</span><StudentPicker students={students.data ?? []} value={studentId} onChange={setStudentId} /></div>
        <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
        <label className="field"><span>Entry</span><textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}
