import { AppError } from '../db/connection'
import type { Db } from '../db/connection'
import type { LogEntry } from '@shared/types'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
export const MAX_LOG_TITLE = 200
export const MAX_LOG_BODY = 20_000

interface LogRow {
  id: number; student_id: number; first_name: string; last_name: string
  title: string; body: string; archived: number; created_at: string
}

const SELECT = `SELECT l.id, l.student_id, s.first_name, s.last_name, l.title, l.body, l.archived, l.created_at
  FROM log_entries l JOIN students s ON s.id = l.student_id`

const toEntry = (r: LogRow): LogEntry => ({
  id: r.id, studentId: r.student_id, studentFirstName: r.first_name, studentLastName: r.last_name,
  title: r.title, body: r.body, archived: r.archived === 1, createdAt: r.created_at
})

export function listLogEntries(db: Db, input: { archived: boolean; studentId?: number }): LogEntry[] {
  const rows = db
    .prepare(`${SELECT} WHERE l.archived = ? AND (? IS NULL OR l.student_id = ?) ORDER BY l.created_at DESC, l.id DESC`)
    .all(input.archived ? 1 : 0, input.studentId ?? null, input.studentId ?? null) as unknown as LogRow[]
  return rows.map(toEntry)
}

export function createLogEntry(db: Db, input: { studentId: number; title: string; body: string }): LogEntry {
  const title = input.title.trim()
  const body = input.body.trim()
  if (!title) throw new AppError('A title is required.')
  if (title.length > MAX_LOG_TITLE) throw new AppError(`The title must be ${MAX_LOG_TITLE} characters or fewer.`)
  if (body.length > MAX_LOG_BODY) throw new AppError(`The entry must be ${MAX_LOG_BODY} characters or fewer.`)
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(input.studentId)) throw new AppError('Student not found.')
  const { lastInsertRowid } = db.prepare('INSERT INTO log_entries (student_id, title, body) VALUES (?, ?, ?)').run(input.studentId, title, body)
  return toEntry(db.prepare(`${SELECT} WHERE l.id = ?`).get(Number(lastInsertRowid)) as unknown as LogRow)
}

export function setLogEntryArchived(db: Db, input: { id: number; archived: boolean }): void {
  const { changes } = db.prepare(`UPDATE log_entries SET archived = ?, updated_at = ${NOW} WHERE id = ?`).run(input.archived ? 1 : 0, input.id)
  if (!changes) throw new AppError('Log entry not found.')
}
