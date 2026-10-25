import { useCallback, useState } from 'react'
import type { PointerEvent } from 'react'

const STORAGE_KEY = 'gradebook.columnWidths'
const MIN_WIDTH = 72

export const STUDENT_COL = 'student'
export const assignmentCol = (id: number): string => `a:${id}`
export const stemCol = (id: number): string => `s:${id}`

function load(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** User-chosen column widths in px, remembered across tabs and sessions. Unset columns use the given default. */
export function useColumnWidths() {
  const [widths, setWidths] = useState(load)

  const update = useCallback((next: (cur: Record<string, number>) => Record<string, number>) => {
    setWidths((cur) => {
      const value = next(cur)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      return value
    })
  }, [])

  const widthOf = (key: string, fallback: number): number => widths[key] ?? fallback
  const setWidth = (key: string, px: number) => update((cur) => ({ ...cur, [key]: Math.max(MIN_WIDTH, Math.round(px)) }))
  const reset = (key: string) => update((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key)))
  return { widthOf, setWidth, reset }
}

export type ColumnWidths = ReturnType<typeof useColumnWidths>

/** Drag handle on a header cell's right edge. Double-click restores the default width. */
export function ResizeHandle({ colKey, current, widths, label }: { colKey: string; current: number; widths: ColumnWidths; label: string }) {
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = current
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => widths.setWidth(colKey, startWidth + ev.clientX - startX)
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  return (
    <span
      className="col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => widths.reset(colKey)}
    />
  )
}
