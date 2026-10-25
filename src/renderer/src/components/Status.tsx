import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage } from '../hooks'

interface StatusApi {
  /** Wrap a save: shows "Saving…" while pending, "Saved" on success, a persistent error on failure. */
  track: <T>(work: Promise<T>) => Promise<T>
  notify: (message: string) => void
  fail: (message: string) => void
}

const Ctx = createContext<StatusApi | null>(null)
export const useStatus = (): StatusApi => {
  const v = useContext(Ctx)
  if (!v) throw new Error('StatusProvider missing')
  return v
}

export function StatusProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(0)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ id: number; text: string }[]>([])
  const nextId = useRef(1)
  const pendingRef = useRef(0)

  const fail = useCallback((text: string) => setErrors((e) => [...e, { id: nextId.current++, text }]), [])
  const notify = useCallback((text: string) => setInfo(text), [])
  const track = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      pendingRef.current++
      setPending((p) => p + 1)
      try {
        const result = await work
        setSavedAt(Date.now())
        return result
      } catch (e) {
        fail(errorMessage(e))
        throw e
      } finally {
        pendingRef.current--
        setPending((p) => p - 1)
      }
    },
    [fail]
  )

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (pendingRef.current > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  useEffect(() => {
    if (!info) return
    const t = setTimeout(() => setInfo(null), 6000)
    return () => clearTimeout(t)
  }, [info])

  const value = useMemo(() => ({ track, notify, fail }), [track, notify, fail])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="status-area">
        {errors.map((e) => (
          <div key={e.id} className="toast toast-error" role="alert">
            <span>{e.text}</span>
            <button className="link" onClick={() => setErrors((list) => list.filter((x) => x.id !== e.id))}>
              Dismiss
            </button>
          </div>
        ))}
        {info && (
          <div className="toast" role="status">
            {info}
          </div>
        )}
        <div className="save-indicator" role="status" aria-live="polite">
          {pending > 0 ? 'Saving…' : savedAt ? 'All changes saved' : 'Ready'}
        </div>
      </div>
    </Ctx.Provider>
  )
}
