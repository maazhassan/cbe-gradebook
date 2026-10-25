import { useCallback, useEffect, useRef, useState } from 'react'

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  setData: (update: (current: T) => T) => void
}

/** Load data through the API and re-load when `deps` change. Stale responses are ignored. */
export function useLoad<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const ticket = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const data = await fetchRef.current()
      if (mine === ticket.current) setState({ data, error: null, loading: false })
    } catch (e) {
      if (mine === ticket.current) setState((s) => ({ ...s, error: errorMessage(e), loading: false }))
    }
  }, [])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    void reload()
    const counter = ticket
    return () => {
      counter.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const setData = useCallback((update: (current: T) => T) => {
    setState((s) => (s.data ? { ...s, data: update(s.data) } : s))
  }, [])

  return { ...state, reload, setData }
}
