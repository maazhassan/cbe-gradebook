import { AppError } from '../db/connection'
import type { Db } from '../db/connection'
import type { Course } from '@shared/types'

interface CourseRow {
  id: number; name: string; subject_id: number; subject_name: string; archived: number; active_count: number
}

const SELECT = `
  SELECT c.id, c.name, c.subject_id, s.name AS subject_name, c.archived,
    (SELECT COUNT(*) FROM course_enrollments e JOIN students st ON st.id = e.student_id
      WHERE e.course_id = c.id AND e.active = 1 AND st.archived = 0) AS active_count
  FROM courses c JOIN subjects s ON s.id = c.subject_id`

const toCourse = (r: CourseRow): Course => ({
  id: r.id, name: r.name, subjectId: r.subject_id, subjectName: r.subject_name,
  archived: r.archived === 1, activeStudentCount: r.active_count
})

export function listCourses(db: Db): Course[] {
  const rows = db.prepare(`${SELECT} ORDER BY c.archived, c.name COLLATE NOCASE, c.id`).all() as unknown as CourseRow[]
  return rows.map(toCourse)
}

export function getCourse(db: Db, id: number): Course {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CourseRow | undefined
  if (!row) throw new AppError('Course not found.')
  return toCourse(row)
}

function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new AppError('Course name is required.')
  if (trimmed.length > 100) throw new AppError('Course name must be 100 characters or fewer.')
  return trimmed
}

export function createCourse(db: Db, input: { name: string; subjectId: number }): Course {
  const name = cleanName(input.name)
  if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(input.subjectId)) throw new AppError('Choose a subject.')
  const { lastInsertRowid } = db.prepare('INSERT INTO courses (name, subject_id) VALUES (?, ?)').run(name, input.subjectId)
  return getCourse(db, Number(lastInsertRowid))
}

export function updateCourse(db: Db, input: { id: number; name: string }): Course {
  const name = cleanName(input.name)
  getCourse(db, input.id)
  db.prepare("UPDATE courses SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(name, input.id)
  return getCourse(db, input.id)
}

export function setCourseArchived(db: Db, input: { id: number; archived: boolean }): void {
  getCourse(db, input.id)
  db.prepare("UPDATE courses SET archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(input.archived ? 1 : 0, input.id)
}
