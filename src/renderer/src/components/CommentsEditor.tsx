import { useEffect, useRef, useState } from 'react'
import type { Comments } from '@shared/types'
import { errorMessage } from '../hooks'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
const FIELDS: { key: keyof Comments; label: string }[] = [
  { key: 'positiveComment1', label: 'Positive comment 1' },
  { key: 'positiveComment2', label: 'Positive comment 2' },
  { key: 'growthComment', label: 'Growth comment' }
]
const DEBOUNCE_MS = 800

/** Autosaving report-card comments. Unsaved text is flushed on blur and when leaving the student. */
export function CommentsEditor({ studentId, initial }: { studentId: number; initial: Comments }) {
  const [draft, setDraft] = useState<Comments>(initial)
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(draft)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const save = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    const snapshot = latest.current
    dirty.current = false
    if (alive.current) setState('saving')
    try {
      await window.api.updateStudentComments({ id: studentId, ...snapshot })
      if (alive.current) {
        setError(null)
        setState(dirty.current ? 'dirty' : 'saved')
      }
    } catch (e) {
      dirty.current = true
      if (alive.current) {
        setError(errorMessage(e))
        setState('error')
      }
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void saveRef.current() // flush pending edits when switching student or page
    }
  }, [])

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const change = (key: keyof Comments, value: string) => {
    const next = { ...latest.current, [key]: value }
    latest.current = next
    dirty.current = true
    setDraft(next)
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void saveRef.current(), DEBOUNCE_MS)
  }

  const label = { saved: 'Saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved' }[state]
  return (
    <section className="panel" aria-labelledby="comments-h">
      <div className="panel-head">
        <h2 id="comments-h">Report-card comments</h2>
        <span className={`save-state ${state}`} role="status">
          {label}
          {state === 'error' && <button className="link" onClick={() => void save()}>Retry</button>}
        </span>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="comments">
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <textarea rows={3} value={draft[f.key]} onChange={(e) => change(f.key, e.target.value)} onBlur={() => void save()} maxLength={5000} />
          </label>
        ))}
      </div>
    </section>
  )
}
