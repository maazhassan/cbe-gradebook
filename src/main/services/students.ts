import { AppError, transaction } from '../db/connection'
import type { Db } from '../db/connection'
import type { Comments, Enrollment, RosterAction, RosterImportResult, Student, StudentListItem } from '@shared/types'

interface StudentRow {
  id: number; first_name: string; last_name: string; archived: number
  positive_comment_1: string; positive_comment_2: string; growth_comment: string
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
export const MAX_COMMENT = 5000

function cleanName(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new AppError(`${label} is required.`)
  if (trimmed.length > 100) throw new AppError(`${label} must be 100 characters or fewer.`)
  return trimmed
}

export function listStudents(db: Db): StudentListItem[] {
  const students = db
    .prepare('SELECT id, first_name, last_name, archived FROM students ORDER BY archived, last_name COLLATE NOCASE, first_name COLLATE NOCASE, id')
    .all() as { id: number; first_name: string; last_name: string; archived: number }[]
  const enrol = db.prepare('SELECT student_id, course_id FROM course_enrollments WHERE active = 1').all() as { student_id: number; course_id: number }[]
  const byStudent = new Map<number, number[]>()
  for (const e of enrol) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e.course_id])
  return students.map((s) => ({
    id: s.id, firstName: s.first_name, lastName: s.last_name, archived: s.archived === 1,
    activeCourseIds: byStudent.get(s.id) ?? []
  }))
}

export function getStudent(db: Db, id: number): Student {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as StudentRow | undefined
  if (!row) throw new AppError('Student not found.')
  const enrollments = (
    db
      .prepare(`SELECT c.id AS course_id, c.name AS course_name, s.name AS subject_name, c.archived AS course_archived, e.active
        FROM course_enrollments e JOIN courses c ON c.id = e.course_id JOIN subjects s ON s.id = c.subject_id
        WHERE e.student_id = ? ORDER BY c.archived, c.name COLLATE NOCASE`)
      .all(id) as { course_id: number; course_name: string; subject_name: string; course_archived: number; active: number }[]
  ).map(
    (e): Enrollment => ({
      courseId: e.course_id, courseName: e.course_name, subjectName: e.subject_name,
      courseArchived: e.course_archived === 1, active: e.active === 1
    })
  )
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, archived: row.archived === 1,
    positiveComment1: row.positive_comment_1, positiveComment2: row.positive_comment_2,
    growthComment: row.growth_comment, enrollments
  }
}

export function setEnrollment(db: Db, input: { studentId: number; courseId: number; active: boolean }): void {
  transaction(db, () => {
    const student = db.prepare('SELECT archived FROM students WHERE id = ?').get(input.studentId) as { archived: number } | undefined
    const course = db.prepare('SELECT archived FROM courses WHERE id = ?').get(input.courseId) as { archived: number } | undefined
    if (!student) throw new AppError('Student not found.')
    if (!course) throw new AppError('Course not found.')
    if (input.active) {
      if (student.archived) throw new AppError('Reactivate this student before enrolling them in a course.')
      if (course.archived) throw new AppError('This course is archived. Reactivate it before enrolling students.')
    }
    // One row per (student, course): re-enrolling reactivates it, so there are never duplicates.
    db.prepare(
      `INSERT INTO course_enrollments (student_id, course_id, active) VALUES (?, ?, ?)
       ON CONFLICT (student_id, course_id) DO UPDATE SET active = excluded.active, updated_at = ${NOW}`
    ).run(input.studentId, input.courseId, input.active ? 1 : 0)
  })
}

export function createStudent(db: Db, input: { firstName: string; lastName: string; courseIds: number[] }): Student {
  const firstName = cleanName(input.firstName, 'First name')
  const lastName = cleanName(input.lastName, 'Last name')
  const id = transaction(db, () => {
    const { lastInsertRowid } = db.prepare('INSERT INTO students (first_name, last_name) VALUES (?, ?)').run(firstName, lastName)
    for (const courseId of new Set(input.courseIds)) setEnrollment(db, { studentId: Number(lastInsertRowid), courseId, active: true })
    return Number(lastInsertRowid)
  })
  return getStudent(db, id)
}

export function updateStudent(db: Db, input: { id: number; firstName: string; lastName: string }): Student {
  const firstName = cleanName(input.firstName, 'First name')
  const lastName = cleanName(input.lastName, 'Last name')
  getStudent(db, input.id)
  db.prepare(`UPDATE students SET first_name = ?, last_name = ?, updated_at = ${NOW} WHERE id = ?`).run(firstName, lastName, input.id)
  return getStudent(db, input.id)
}

/** Archiving keeps every grade, comment and enrolment row; it only hides the student from active rosters. */
export function setStudentArchived(db: Db, input: { id: number; archived: boolean }): void {
  getStudent(db, input.id)
  db.prepare(`UPDATE students SET archived = ?, updated_at = ${NOW} WHERE id = ?`).run(input.archived ? 1 : 0, input.id)
}

export function updateStudentComments(db: Db, input: { id: number } & Comments): void {
  for (const text of [input.positiveComment1, input.positiveComment2, input.growthComment]) {
    if (text.length > MAX_COMMENT) throw new AppError(`Comments must be ${MAX_COMMENT} characters or fewer.`)
  }
  getStudent(db, input.id)
  db.prepare(
    `UPDATE students SET positive_comment_1 = ?, positive_comment_2 = ?, growth_comment = ?, updated_at = ${NOW} WHERE id = ?`
  ).run(input.positiveComment1, input.positiveComment2, input.growthComment, input.id)
}

/** The renderer has already let the teacher review duplicates; `existing` rows reuse a student, never merge by name. */
export function importRoster(db: Db, input: { rows: RosterAction[]; courseIds: number[] }): RosterImportResult {
  const courseIds = [...new Set(input.courseIds)]
  return transaction(db, () => {
    const result: RosterImportResult = { created: 0, matchedExisting: 0, enrolments: 0 }
    for (const row of input.rows) {
      let studentId: number
      if (row.action === 'create') {
        const first = cleanName(row.firstName, 'First name')
        const last = cleanName(row.lastName, 'Last name')
        studentId = Number(db.prepare('INSERT INTO students (first_name, last_name) VALUES (?, ?)').run(first, last).lastInsertRowid)
        result.created++
      } else {
        studentId = row.studentId
        result.matchedExisting++
      }
      for (const courseId of courseIds) {
        setEnrollment(db, { studentId, courseId, active: true })
        result.enrolments++
      }
    }
    return result
  })
}
