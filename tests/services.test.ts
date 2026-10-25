import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/connection'
import * as stems from '../src/main/services/stems'
import * as courses from '../src/main/services/courses'
import * as students from '../src/main/services/students'
import * as gb from '../src/main/services/gradebook'
import * as logs from '../src/main/services/logEntries'
import { ScoreIndex, stemAveragesForStudent, toPowerSchoolGrade } from '../src/shared/grading'
import { powerSchoolCsv, rawScoresCsv, stemAveragesCsv } from '../src/shared/export'
import { memoryDb, setup, stemId, subjectId } from './helpers'

let db: Db
let ctx: ReturnType<typeof setup>
beforeEach(() => {
  db = memoryDb()
  ctx = setup(db)
})

const derive = (courseId: number, studentId: number) => {
  const g = gb.getGradebook(db, courseId)
  const idx = new ScoreIndex(g.scores)
  return {
    grades: g.assignments.map((a) => toPowerSchoolGrade(idx.get(studentId, a.id), a.maxPoints)),
    averages: stemAveragesForStudent(g.assignments, g.stems.map((s) => s.id), (aid) => idx.get(studentId, aid))
  }
}
const newAssignment = (over: Partial<Parameters<typeof gb.createAssignment>[1]> = {}) =>
  gb.createAssignment(db, { courseId: ctx.ela.id, name: 'Essay', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [], ...over })

describe('seed data and stems', () => {
  it('seeds subjects and stems in order from the database', () => {
    const all = stems.listStems(db)
    const names = (subject: string) => all.filter((s) => s.subjectId === subjectId(db, subject)).map((s) => s.name)
    expect(names('ELA')).toEqual(['Reads', 'Writes', 'Manages', 'Speaks', 'Listens', 'Represents'])
    expect(names('Social Studies')).toEqual(['Understands', 'Explores', 'Inquires', 'Communicates'])
  })
  it('each course view shows its own subject stems', () => {
    expect(gb.getGradebook(db, ctx.ela.id).stems.map((s) => s.name)).toContain('Reads')
    expect(gb.getGradebook(db, ctx.social.id).stems.map((s) => s.name)).toEqual(['Understands', 'Explores', 'Inquires', 'Communicates'])
  })
  it('add, rename, reorder, deactivate; duplicate names rejected', () => {
    const sid = subjectId(db, 'ELA')
    stems.createStem(db, { subjectId: sid, name: 'Views' })
    expect(() => stems.createStem(db, { subjectId: sid, name: 'reads' })).toThrow(/already/)
    const reads = stemId(db, 'ELA', 'Reads')
    stems.moveStem(db, { id: reads, direction: 'down' })
    const order = stems.listStems(db).filter((s) => s.subjectId === sid).map((s) => s.name)
    expect(order.slice(0, 2)).toEqual(['Writes', 'Reads'])
    stems.renameStem(db, { id: reads, name: 'Reading' })
    expect(stems.listStems(db).find((s) => s.id === reads)?.name).toBe('Reading')
  })
  it('deactivated stems stay on existing assignments but cannot be added to new ones', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const a = newAssignment({ stemIds: [reads] })
    stems.setStemActive(db, { id: reads, active: false })
    expect(gb.getGradebook(db, ctx.ela.id).stems.map((s) => s.name)).toContain('Reads')
    expect(() => newAssignment({ stemIds: [reads] })).toThrow(/inactive/)
    // editing the existing assignment keeps the link
    const updated = gb.updateAssignment(db, { id: a.id, name: 'Essay 2', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [reads] })
    expect(updated.stemIds).toEqual([reads])
    // once unused anywhere, it disappears from the course view
    gb.updateAssignment(db, { id: a.id, name: 'Essay 2', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [] })
    expect(gb.getGradebook(db, ctx.ela.id).stems.map((s) => s.name)).not.toContain('Reads')
    expect(() => db.prepare('DELETE FROM stems WHERE id = ?').run(reads)).not.toThrow()
  })
  it('a used stem cannot be hard-deleted', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    newAssignment({ stemIds: [reads] })
    expect(() => db.prepare('DELETE FROM stems WHERE id = ?').run(reads)).toThrow()
  })
  it('stems must belong to the course subject', () => {
    expect(() => newAssignment({ stemIds: [stemId(db, 'Social Studies', 'Explores')] })).toThrow(/subject/)
  })
})

describe('students and enrolment', () => {
  it('one student record can be in ELA and Social without duplication', () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM students WHERE first_name = ?').get('Ada') as { n: number }
    expect(count.n).toBe(1)
    expect(ctx.ada.enrollments.map((e) => e.courseName).sort()).toEqual(['ELA 8A', 'Social 8A'])
    expect(gb.getGradebook(db, ctx.social.id).students.map((s) => s.id)).toEqual([ctx.ada.id])
  })
  it('never duplicates an enrolment', () => {
    students.setEnrollment(db, { studentId: ctx.ada.id, courseId: ctx.ela.id, active: true })
    students.setEnrollment(db, { studentId: ctx.ada.id, courseId: ctx.ela.id, active: true })
    const n = db.prepare('SELECT COUNT(*) AS n FROM course_enrollments WHERE student_id = ? AND course_id = ?').get(ctx.ada.id, ctx.ela.id) as { n: number }
    expect(n.n).toBe(1)
  })
  it('missing counts as 0, exempt is excluded, and both round-trip', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const a = gb.createAssignment(db, { courseId: ctx.ela.id, name: 'ME', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [reads] })
    const b = gb.createAssignment(db, { courseId: ctx.ela.id, name: 'Full', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [reads] })
    gb.setRawScore(db, { assignmentId: b.id, studentId: ctx.ada.id, rawScore: 10 })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 'M' })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 'E' })
    gb.setRawScore(db, { assignmentId: b.id, studentId: ctx.ben.id, rawScore: 10 })
    const g = gb.getGradebook(db, ctx.ela.id)
    const idx = new ScoreIndex(g.scores)
    expect(idx.get(ctx.ada.id, a.id)).toBe('M')
    expect(idx.get(ctx.ben.id, a.id)).toBe('E')
    const avg = (sid: number) => stemAveragesForStudent(g.assignments, [reads], (id) => idx.get(sid, id)).get(reads)
    expect(avg(ctx.ada.id)).toBe(2.5) // (1 + 4) / 2
    expect(avg(ctx.ben.id)).toBe(4) // exempt ignored
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 7 })
    expect(new ScoreIndex(gb.getGradebook(db, ctx.ela.id).scores).get(ctx.ada.id, a.id)).toBe(7)
  })

  it('requires a valid due date and shows it in the exports', () => {
    for (const bad of ['', '2026-02-30', '24/10/2026', 'tomorrow']) {
      expect(() => newAssignment({ dueDate: bad })).toThrow(/[Dd]ue date/)
    }
    const a = newAssignment({ dueDate: '2026-11-03' })
    expect(a.dueDate).toBe('2026-11-03')
    expect(rawScoresCsv(gb.getGradebook(db, ctx.ela.id))).toContain('due Nov 3, 2026')
    expect(gb.updateAssignment(db, { id: a.id, name: 'Essay', maxPoints: 10, weight: 1, dueDate: '2026-12-01', stemIds: [] }).dueDate).toBe('2026-12-01')
  })
  it('validates names and comments, and persists comments', () => {
    expect(() => students.createStudent(db, { firstName: ' ', lastName: 'X', courseIds: [] })).toThrow()
    students.updateStudentComments(db, { id: ctx.ada.id, positiveComment1: 'a', positiveComment2: 'b', growthComment: 'c' })
    const s = students.getStudent(db, ctx.ada.id)
    expect([s.positiveComment1, s.positiveComment2, s.growthComment]).toEqual(['a', 'b', 'c'])
  })
  it('roster import: creates, reuses existing explicitly, enrols', () => {
    const r = students.importRoster(db, {
      rows: [{ action: 'create', firstName: 'Cy', lastName: 'Young' }, { action: 'existing', studentId: ctx.ada.id }],
      courseIds: [ctx.social.id]
    })
    expect(r).toEqual({ created: 1, matchedExisting: 1, enrolments: 2 })
    expect(gb.getGradebook(db, ctx.social.id).students).toHaveLength(2)
  })
})

describe('assignments and scores', () => {
  it('new assignments appear with blank scores and keep existing scores when others are added', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 8 })
    const b = newAssignment({ name: 'Quiz' })
    const g = gb.getGradebook(db, ctx.ela.id)
    expect(g.assignments.map((x) => x.name)).toEqual(['Essay', 'Quiz'])
    expect(g.scores).toEqual([{ assignmentId: a.id, studentId: ctx.ada.id, rawScore: 8 }])
    expect(derive(ctx.ela.id, ctx.ben.id).grades).toEqual([null, null])
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)
  })
  it('score equal to max is accepted; invalid rejected; blank differs from zero', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 10 })
    for (const bad of [-1, 10.5, NaN, Infinity]) {
      expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: bad })).toThrow()
    }
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 0 })
    expect(derive(ctx.ela.id, ctx.ben.id).grades).toEqual([1])
    expect(derive(ctx.ela.id, ctx.ada.id).grades).toEqual([4])
  })
  it('rejects invalid assignment max points and weights', () => {
    for (const maxPoints of [0, -5, NaN, Infinity]) expect(() => newAssignment({ maxPoints })).toThrow()
    for (const weight of [0, -1, 1.5]) expect(() => newAssignment({ weight })).toThrow()
    expect(() => newAssignment({ name: '  ' })).toThrow()
    expect(newAssignment({ maxPoints: 2.5, weight: 3 })).toMatchObject({ maxPoints: 2.5, weight: 3 })
  })
  it('clearing a score restores blank everywhere', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const a = newAssignment({ stemIds: [reads] })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 9 })
    expect(derive(ctx.ela.id, ctx.ada.id).averages.get(reads)).toBe(4)
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: null })
    const d = derive(ctx.ela.id, ctx.ada.id)
    expect(d.grades).toEqual([null])
    expect(d.averages.get(reads)).toBeNull()
  })
  it('changing max points recalculates grades and averages; cannot go below existing scores', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const a = newAssignment({ stemIds: [reads] })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 8 })
    expect(derive(ctx.ela.id, ctx.ada.id).grades).toEqual([3])
    gb.updateAssignment(db, { id: a.id, name: 'Essay', maxPoints: 20, weight: 1, dueDate: '2026-10-24', stemIds: [reads] })
    expect(derive(ctx.ela.id, ctx.ada.id).grades).toEqual([1])
    expect(derive(ctx.ela.id, ctx.ada.id).averages.get(reads)).toBe(1)
    expect(() => gb.updateAssignment(db, { id: a.id, name: 'Essay', maxPoints: 5, weight: 1, dueDate: '2026-10-24', stemIds: [reads] })).toThrow(/higher/)
  })
  it('changing weight or stem links recalculates averages', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const writes = stemId(db, 'ELA', 'Writes')
    const a = newAssignment({ name: 'A', stemIds: [reads] })
    const b = newAssignment({ name: 'B', stemIds: [reads] })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 10 })
    gb.setRawScore(db, { assignmentId: b.id, studentId: ctx.ada.id, rawScore: 2 })
    expect(derive(ctx.ela.id, ctx.ada.id).averages.get(reads)).toBe(2.5)
    gb.updateAssignment(db, { id: b.id, name: 'B', maxPoints: 10, weight: 3, dueDate: '2026-10-24', stemIds: [reads] })
    expect(derive(ctx.ela.id, ctx.ada.id).averages.get(reads)).toBe(1.75)
    gb.updateAssignment(db, { id: b.id, name: 'B', maxPoints: 10, weight: 3, dueDate: '2026-10-24', stemIds: [writes] })
    const avgs = derive(ctx.ela.id, ctx.ada.id).averages
    expect(avgs.get(reads)).toBe(4)
    expect(avgs.get(writes)).toBe(1)
  })
  it('only actively enrolled students can receive scores; history is kept', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 7 })
    students.setEnrollment(db, { studentId: ctx.ben.id, courseId: ctx.ela.id, active: false })
    expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 8 })).toThrow(/enrolled/)
    expect(gb.getGradebook(db, ctx.ela.id).students.map((s) => s.id)).toEqual([ctx.ada.id])
    // never enrolled student
    const stranger = students.createStudent(db, { firstName: 'Zed', lastName: 'Zee', courseIds: [] })
    expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: stranger.id, rawScore: 8 })).toThrow()
    // DB-level guard also holds without the service check
    expect(() => db.prepare('INSERT INTO grades (assignment_id, student_id, raw_score) VALUES (?,?,?)').run(a.id, stranger.id, 1)).toThrow()
    expect(() => db.prepare('INSERT INTO grades (assignment_id, student_id, raw_score) VALUES (?,?,?)').run(a.id, ctx.ada.id, 99)).toThrow()
    // history still visible on the dashboard
    const dash = gb.getStudentDashboard(db, ctx.ben.id)
    expect(dash.courses[0]).toMatchObject({ enrollmentActive: false })
    expect(dash.courses[0]?.scores).toHaveLength(1)
  })
})

describe('archiving keeps history', () => {
  it('archived student keeps grades and comments, leaves active rosters', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 7 })
    students.updateStudentComments(db, { id: ctx.ben.id, positiveComment1: 'kind', positiveComment2: '', growthComment: '' })
    students.setStudentArchived(db, { id: ctx.ben.id, archived: true })
    expect(gb.getGradebook(db, ctx.ela.id).students.map((s) => s.id)).toEqual([ctx.ada.id])
    expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ben.id, rawScore: 9 })).toThrow()
    const dash = gb.getStudentDashboard(db, ctx.ben.id)
    expect(dash.student.positiveComment1).toBe('kind')
    expect(dash.courses[0]?.scores[0]?.rawScore).toBe(7)
    expect(() => students.setEnrollment(db, { studentId: ctx.ben.id, courseId: ctx.social.id, active: true })).toThrow()
    students.setStudentArchived(db, { id: ctx.ben.id, archived: false })
    expect(gb.getGradebook(db, ctx.ela.id).students).toHaveLength(2)
  })
  it('archived course keeps data, is read-only, appears in dashboards', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 7 })
    courses.setCourseArchived(db, { id: ctx.ela.id, archived: true })
    expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 8 })).toThrow(/archived/)
    const dash = gb.getStudentDashboard(db, ctx.ada.id)
    expect(dash.courses.find((c) => c.course.id === ctx.ela.id)?.course.archived).toBe(true)
    expect(gb.getGradebook(db, ctx.ela.id).scores).toHaveLength(1)
    courses.setCourseArchived(db, { id: ctx.ela.id, archived: false })
    expect(() => gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 8 })).not.toThrow()
  })
  it('archived assignments leave views but keep their scores', () => {
    const a = newAssignment()
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 7 })
    gb.archiveAssignment(db, a.id)
    expect(gb.getGradebook(db, ctx.ela.id).assignments).toEqual([])
    const row = db.prepare('SELECT COUNT(*) AS n FROM grades').get() as { n: number }
    expect(row.n).toBe(1)
  })
  it('course subject cannot change', () => {
    expect(() => db.prepare('UPDATE courses SET subject_id = 2 WHERE id = ?').run(ctx.ela.id)).toThrow()
  })
})

describe('dashboard and exports agree with the gradebook', () => {
  it('shows identical values in all views', () => {
    const reads = stemId(db, 'ELA', 'Reads')
    const a = newAssignment({ name: 'Essay, "final"', stemIds: [reads] })
    gb.setRawScore(db, { assignmentId: a.id, studentId: ctx.ada.id, rawScore: 9 })
    const g = gb.getGradebook(db, ctx.ela.id)
    expect(rawScoresCsv(g)).toContain('"Lovelace, Ada",9')
    expect(rawScoresCsv(g)).toContain('"Okafor, Ben",\r\n')
    expect(powerSchoolCsv(g)).toContain('"Lovelace, Ada",4')
    expect(stemAveragesCsv(g).split('\r\n')[1]).toBe('"Lovelace, Ada",4.00,4,,,,,,,,,,')
    const dash = gb.getStudentDashboard(db, ctx.ada.id)
    const d = dash.courses.find((c) => c.course.id === ctx.ela.id)!
    const idx = new ScoreIndex(d.scores)
    expect(stemAveragesForStudent(d.assignments, d.stems.map((s) => s.id), (id) => idx.get(ctx.ada.id, id)).get(reads)).toBe(4)
  })
})

describe('log entries', () => {
  it('creates entries, lists them per student newest first, and archives/unarchives', () => {
    const first = logs.createLogEntry(db, { studentId: ctx.ada.id, title: ' Late essay ', body: ' Talked after class. ' })
    const second = logs.createLogEntry(db, { studentId: ctx.ada.id, title: 'Parent call', body: '' })
    logs.createLogEntry(db, { studentId: ctx.ben.id, title: 'Other student', body: 'x' })
    expect(first).toMatchObject({ title: 'Late essay', body: 'Talked after class.', studentLastName: 'Lovelace', archived: false })
    expect(logs.listLogEntries(db, { archived: false, studentId: ctx.ada.id }).map((e) => e.id)).toEqual([second.id, first.id])
    expect(logs.listLogEntries(db, { archived: false })).toHaveLength(3)

    logs.setLogEntryArchived(db, { id: first.id, archived: true })
    expect(logs.listLogEntries(db, { archived: false, studentId: ctx.ada.id }).map((e) => e.id)).toEqual([second.id])
    expect(logs.listLogEntries(db, { archived: true }).map((e) => e.id)).toEqual([first.id])
    logs.setLogEntryArchived(db, { id: first.id, archived: false })
    expect(logs.listLogEntries(db, { archived: true })).toEqual([])
  })
  it('validates input', () => {
    expect(() => logs.createLogEntry(db, { studentId: ctx.ada.id, title: '  ', body: 'x' })).toThrow(/title/)
    expect(() => logs.createLogEntry(db, { studentId: 9999, title: 't', body: '' })).toThrow(/not found/)
    expect(() => logs.setLogEntryArchived(db, { id: 9999, archived: true })).toThrow(/not found/)
  })
})
