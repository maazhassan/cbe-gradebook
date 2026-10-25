import { useId, useState } from 'react'
import type { StudentListItem } from '@shared/types'

/** Searchable student dropdown. The typed text matches anywhere in the student's first or last name. */
export function StudentPicker(props: { students: StudentListItem[]; value: number | null; onChange: (id: number | null) => void }) {
  const { students, value, onChange } = props
  const listId = useId()
  const selected = students.find((s) => s.id === value) ?? null
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const q = text.trim().toLowerCase()
  const matches = students.filter((s) => !s.archived && `${s.firstName} ${s.lastName}`.toLowerCase().includes(q))
  const label = (s: StudentListItem) => `${s.lastName}, ${s.firstName}`

  const choose = (s: StudentListItem) => {
    onChange(s.id)
    setText('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      const pick = matches[active]
      if (pick) choose(pick)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="picker">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={selected ? '' : 'Search for a student…'}
        aria-label="Student"
        value={text}
        onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {selected && !text && <span className="picker-chosen">{label(selected)}</span>}
      {open && (
        <ul id={listId} role="listbox" className="picker-list">
          {matches.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose(s) }}
              onMouseEnter={() => setActive(i)}
            >
              {label(s)}
            </li>
          ))}
          {matches.length === 0 && <li className="muted pad">No students match.</li>}
        </ul>
      )}
    </div>
  )
}
