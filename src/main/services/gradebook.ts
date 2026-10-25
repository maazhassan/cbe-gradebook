import { AppError, transaction } from '../db/connection'
import type { Db } from '../db/connection'
import { validateMaxPoints, validateRawScore, validateWeight } from '@shared/grading'
import type { ScoreRecord } from '@shared/grading'
import type { AssignmentInput, CourseGradebook, DashboardCourse, GradebookAssignment, RosterStudent, Stem, StudentDashboard } from '@shared/types'
import { getCourse } from './courses'
import { getStudent } from './students'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

interface AssignmentRow { id: number; course_id: number; name: string; max_points: number; weight: number; sort_order: number; archived: number }

function loadAssignments(db: Db, courseId: number): GradebookAssignment[] {
  const rows = db
    .prepare('SELECT * FROM assignments WHERE course_id = ? AND archived = 0 ORDER BY sort_order, id')
    .all(courseId) as unknown as AssignmentRow[]
  const links = db
    .prepare(`SELECT ast.assignment_id, ast.stem_id FROM assignment_stems ast
      JOIN assignments a ON a.id = ast.assignment_id WHERE a.course_id = ? AND a.archived = 0`)
    .all(courseId) as { assignment_id: number; stem_id: number }[]
  return rows.map((r) => ({
    id: r.id, name: r.name, maxPoints: r.max_points, weight: r.weight, sortOrder: r.sort_order,
    stemIds: links.filter((l) => l.assignment_id === r.id).map((l) => l.stem_id)
  }))
}

/** Active stems of the course's subject (in order), plus inactive ones that existing assignments still use. */
function loadCourseStems(db: Db, subjectId: number, assignments: GradebookAssignment[]): Stem[] {
  const used = new Set(assignments.flatMap((a) => a.stemIds))
  const rows = db
    .prepare('SELECT id, subject_id, name, display_order, active FROM stems WHERE subject_id = ? ORDER BY display_order, id')
    .all(subjectId) as { id: number; subject_id: number; name: string; display_order: number; active: number }[]
  return rows
    .filter((r) => r.active === 1 || used.has(r.id))
    .map((r) => ({ id: r.id, subjectId: r.subject_id, name: r.name, displayOrder: r.display_order, active: r.active === 1 }))
}

export function getGradebook(db: Db, courseId: number): CourseGradebook {
  const course = getCourse(db, courseId)
  const assignments = loadAssignments(db, courseId)
  const students = (
    db
      .prepare(`SELECT st.id, st.first_name, st.last_name FROM course_enrollments e JOIN students st ON st.id = e.student_id
        WHERE e.course_id = ? AND e.active = 1 AND st.archived = 0
        ORDER BY st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE, st.id`)
      .all(courseId) as { id: number; first_name: string; last_name: string }[]
  ).map((s): RosterStudent => ({ id: s.id, firstName: s.first_name, lastName: s.last_name }))
  const scores = (
    db
      .prepare(`SELECT g.assignment_id, g.student_id, g.raw_score FROM grades g JOIN assignments a ON a.id = g.assignment_id
        WHERE a.course_id = ? AND a.archived = 0`)
      .all(courseId) as { assignment_id: number; student_id: number; raw_score: number }[]
  ).map((g): ScoreRecord => ({ assignmentId: g.assignment_id, studentId: g.student_id, rawScore: g.raw_score }))
  return { course, assignments, students, scores, stems: loadCourseStems(db, course.subjectId, assignments) }
}

function validateAssignmentInput(input: AssignmentInput): string {
  const name = input.name.trim()
  if (!name) throw new AppError('Assignment name is required.')
  if (name.length > 100) throw new AppError('Assignment name must be 100 characters or fewer.')
  const error = validateMaxPoints(input.maxPoints) ?? validateWeight(input.weight)
  if (error) throw new AppError(error)
  return name
}

function getAssignmentRow(db: Db, id: number): AssignmentRow {
  const row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as AssignmentRow | undefined
  if (!row || row.archived) throw new AppError('Assignment not found.')
  return row
}

function assertCourseOpen(db: Db, courseId: number): void {
  if (getCourse(db, courseId).archived) throw new AppError('This course is archived and is read-only. Reactivate it to make changes.')
}

function setStemLinks(db: Db, assignmentId: number, subjectId: number, stemIds: number[], keepInactive: Set<number>): void {
  const wanted = [...new Set(stemIds)]
  for (const stemId of wanted) {
    const stem = db.prepare('SELECT subject_id, active FROM stems WHERE id = ?').get(stemId) as { subject_id: number; active: number } | undefined
    if (!stem || stem.subject_id !== subjectId) throw new AppError('A selected stem does not belong to this course’s subject.')
    if (!stem.active && !keepInactive.has(stemId)) throw new AppError('An inactive stem cannot be added to an assignment.')
  }
  db.prepare('DELETE FROM assignment_stems WHERE assignment_id = ?').run(assignmentId)
  const insert = db.prepare('INSERT INTO assignment_stems (assignment_id, stem_id) VALUES (?, ?)')
  for (const stemId of wanted) insert.run(assignmentId, stemId)
}

export function createAssignment(db: Db, input: { courseId: number } & AssignmentInput): GradebookAssignment {
  const name = validateAssignmentInput(input)
  const course = getCourse(db, input.courseId)
  assertCourseOpen(db, input.courseId)
  const id = transaction(db, () => {
    const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM assignments WHERE course_id = ?').get(input.courseId) as { n: number }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO assignments (course_id, name, max_points, weight, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(input.courseId, name, input.maxPoints, input.weight, next.n)
    setStemLinks(db, Number(lastInsertRowid), course.subjectId, input.stemIds, new Set())
    return Number(lastInsertRowid)
  })
  return loadAssignments(db, input.courseId).find((a) => a.id === id)!
}

export function updateAssignment(db: Db, input: { id: number } & AssignmentInput): GradebookAssignment {
  const name = validateAssignmentInput(input)
  const existing = getAssignmentRow(db, input.id)
  const course = getCourse(db, existing.course_id)
  assertCourseOpen(db, existing.course_id)
  transaction(db, () => {
    const tooHigh = db
      .prepare('SELECT COUNT(*) AS n FROM grades WHERE assignment_id = ? AND raw_score > ?')
      .get(input.id, input.maxPoints) as { n: number }
    if (tooHigh.n > 0) {
      throw new AppError(`${tooHigh.n} existing score${tooHigh.n === 1 ? ' is' : 's are'} higher than ${input.maxPoints}. Fix those scores before lowering the maximum.`)
    }
    db.prepare(`UPDATE assignments SET name = ?, max_points = ?, weight = ?, updated_at = ${NOW} WHERE id = ?`).run(name, input.maxPoints, input.weight, input.id)
    const linked = db.prepare('SELECT stem_id FROM assignment_stems WHERE assignment_id = ?').all(input.id) as { stem_id: number }[]
    setStemLinks(db, input.id, course.subjectId, input.stemIds, new Set(linked.map((l) => l.stem_id)))
  })
  return loadAssignments(db, existing.course_id).find((a) => a.id === input.id)!
}

/** Archived assignments leave every view and calculation but their scores stay in the database. */
export function archiveAssignment(db: Db, id: number): void {
  const existing = getAssignmentRow(db, id)
  assertCourseOpen(db, existing.course_id)
  db.prepare(`UPDATE assignments SET archived = 1, updated_at = ${NOW} WHERE id = ?`).run(id)
}

export function setRawScore(db: Db, input: { assignmentId: number; studentId: number; rawScore: number | null }): void {
  transaction(db, () => {
    const assignment = getAssignmentRow(db, input.assignmentId)
    assertCourseOpen(db, assignment.course_id)
    const error = validateRawScore(input.rawScore, assignment.max_points)
    if (error) throw new AppError(error)
    const enrolled = db
      .prepare(`SELECT 1 FROM course_enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.course_id = ? AND e.student_id = ? AND e.active = 1 AND s.archived = 0`)
      .get(assignment.course_id, input.studentId)
    if (!enrolled) throw new AppError('This student is not actively enrolled in the course, so scores cannot be entered.')
    if (input.rawScore === null) {
      db.prepare('DELETE FROM grades WHERE assignment_id = ? AND student_id = ?').run(input.assignmentId, input.studentId)
    } else {
      db.prepare(
        `INSERT INTO grades (assignment_id, student_id, raw_score) VALUES (?, ?, ?)
         ON CONFLICT (assignment_id, student_id) DO UPDATE SET raw_score = excluded.raw_score, updated_at = ${NOW}`
      ).run(input.assignmentId, input.studentId, input.rawScore)
    }
  })
}

export function getStudentDashboard(db: Db, studentId: number): StudentDashboard {
  const student = getStudent(db, studentId)
  const courses: DashboardCourse[] = student.enrollments.map((enrollment) => {
    const course = getCourse(db, enrollment.courseId)
    const assignments = loadAssignments(db, course.id)
    const scores = (
      db
        .prepare(`SELECT g.assignment_id, g.raw_score FROM grades g JOIN assignments a ON a.id = g.assignment_id
          WHERE a.course_id = ? AND a.archived = 0 AND g.student_id = ?`)
        .all(course.id, studentId) as { assignment_id: number; raw_score: number }[]
    ).map((g): ScoreRecord => ({ assignmentId: g.assignment_id, studentId, rawScore: g.raw_score }))
    return { course, enrollmentActive: enrollment.active, assignments, scores, stems: loadCourseStems(db, course.subjectId, assignments) }
  })
  return { student, courses }
}
