import { useState } from 'react'
import type { CourseGradebook } from '@shared/types'
import { errorMessage, useLoad } from '../hooks'
import { Modal } from './Modal'

export function ArchivedAssignmentsDialog({ gb, readOnly, onClose, onRestored }: { gb: CourseGradebook; readOnly: boolean; onClose: () => void; onRestored: () => void }) {
  const list = useLoad(() => window.api.listArchivedAssignments(gb.course.id), [gb.course.id])
  const [error, setError] = useState<string | null>(null)

  const restore = async (id: number) => {
    try {
      await window.api.unarchiveAssignment(id)
      setError(null)
      await list.reload()
      onRestored()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title={`Archived assignments — ${gb.course.name}`} onClose={onClose} wide>
      {list.error && <p className="field-error" role="alert">{list.error}</p>}
      {list.data && list.data.length === 0 && <p className="muted">No archived assignments.</p>}
      {readOnly && <p className="hint">This course is archived. Reactivate it in Courses to restore assignments.</p>}
      {list.data && list.data.length > 0 && (
        <table className="list-table">
          <thead><tr><th>Assignment</th><th>Due</th><th>Max</th><th>Weight</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.dueDate}</td>
                <td>{a.maxPoints}</td>
                <td>{a.weight}</td>
                <td className="actions"><button onClick={() => void restore(a.id)} disabled={readOnly}>Unarchive</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><button onClick={onClose}>Close</button></div>
    </Modal>
  )
}
