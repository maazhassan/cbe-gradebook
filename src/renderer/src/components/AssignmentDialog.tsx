import { useState } from 'react'
import type { FormEvent } from 'react'
import { parsePositiveNumber, validateDueDate, validateMaxPoints, validateWeight } from '@shared/grading'
import type { CourseGradebook, GradebookAssignment } from '@shared/types'
import { errorMessage } from '../hooks'
import { Modal, useConfirm } from './Modal'

export function AssignmentDialog(props: {
  gb: CourseGradebook
  assignment: GradebookAssignment | null
  onClose: () => void
  onSaved: () => void
}) {
  const { gb, assignment, onClose, onSaved } = props
  const confirm = useConfirm()
  const [name, setName] = useState(assignment?.name ?? '')
  const [max, setMax] = useState(assignment ? String(assignment.maxPoints) : '')
  const [weight, setWeight] = useState(String(assignment?.weight ?? 1))
  const [dueDate, setDueDate] = useState(assignment?.dueDate ?? '')
  const [stemIds, setStemIds] = useState<number[]>(assignment?.stemIds ?? [])
  const [errors, setErrors] = useState<{ name?: string; max?: string; weight?: string; dueDate?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  // New assignments may only use active stems; existing links to inactive stems stay visible.
  const offered = gb.stems.filter((s) => s.active || assignment?.stemIds.includes(s.id))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const maxPoints = parsePositiveNumber(max)
    const w = /^\d+$/.test(weight.trim()) ? Number(weight) : NaN
    const next = {
      name: name.trim() ? undefined : 'Enter a name.',
      max: maxPoints === null ? 'Enter a number greater than 0.' : validateMaxPoints(maxPoints) ?? undefined,
      weight: validateWeight(w) ?? undefined,
      dueDate: validateDueDate(dueDate) ?? undefined
    }
    if (next.name || next.max || next.weight || next.dueDate) return setErrors(next)
    setBusy(true)
    try {
      const input = { name: name.trim(), maxPoints: maxPoints!, weight: w, dueDate, stemIds }
      if (assignment) await window.api.updateAssignment({ id: assignment.id, ...input })
      else await window.api.createAssignment({ courseId: gb.course.id, ...input })
      onSaved()
    } catch (err) {
      setErrors({ form: errorMessage(err) })
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!assignment) return
    const ok = await confirm({
      title: 'Archive assignment?',
      message: `“${assignment.name}” will be removed from the gradebook views and stem averages. Its scores stay in the database and you can restore it from “Archived assignments”.`,
      confirmLabel: 'Archive',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.archiveAssignment(assignment.id)
      onSaved()
    } catch (err) {
      setErrors({ form: errorMessage(err) })
    }
  }

  return (
    <Modal title={assignment ? 'Edit assignment' : 'Add assignment'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>Name</span>
          <input spellCheck value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!errors.name} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <div className="row">
          <label className="field">
            <span>Maximum points</span>
            <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" aria-invalid={!!errors.max} />
            {errors.max && <span className="field-error">{errors.max}</span>}
          </label>
          <label className="field">
            <span>Weight</span>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" aria-invalid={!!errors.weight} />
            <span className="hint">Relative importance: weight 2 counts twice as much as weight 1.</span>
            {errors.weight && <span className="field-error">{errors.weight}</span>}
          </label>
        </div>
        <label className="field">
          <span>Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={!!errors.dueDate} />
          {errors.dueDate && <span className="field-error">{errors.dueDate}</span>}
        </label>
        <fieldset className="field">
          <legend>Learning stems</legend>
          {offered.length === 0 && <span className="muted">No stems are available for this subject. Add some in Settings.</span>}
          <div className="checks">
            {offered.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={stemIds.includes(s.id)}
                  onChange={(e) => setStemIds(e.target.checked ? [...stemIds, s.id] : stemIds.filter((x) => x !== s.id))}
                />
                {s.name}
                {!s.active && <span className="muted small"> (inactive)</span>}
              </label>
            ))}
          </div>
          <span className="hint">With no stems, the assignment is shown but counts toward no stem average.</span>
        </fieldset>
        {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
        <div className="form-actions">
          {assignment && (
            <button type="button" className="danger-outline push-left" onClick={archive}>
              Archive…
            </button>
          )}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>
            {assignment ? 'Save changes' : 'Add assignment'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
