import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, userVersion } from '../src/main/db/connection'
import { DbHolder, runMigrations } from '../src/main/db/holder'
import { MIGRATIONS } from '../src/main/db/migrations'
import type { Migration } from '../src/main/db/migrations'
import { pruneBackups, validateDatabaseFile } from '../src/main/db/backup'
import * as courses from '../src/main/services/courses'
import * as students from '../src/main/services/students'
import * as gb from '../src/main/services/gradebook'
import { tempDir } from './helpers'

const NEXT = MIGRATIONS.length + 1
const v2: Migration = { version: NEXT, name: 'add nickname', sql: 'ALTER TABLE students ADD COLUMN nickname TEXT;' }
const badV2: Migration = {
  version: NEXT,
  name: 'broken',
  sql: "ALTER TABLE students ADD COLUMN nickname TEXT; INSERT INTO students (first_name, last_name) VALUES ('Half', 'Done'); SELECT nope FROM nowhere;"
}

function seed(path: string) {
  const holder = new DbHolder(path, join(path, '..', 'backups'))
  holder.open()
  const course = courses.createCourse(holder.db, { name: 'ELA', subjectId: 1 })
  const s = students.createStudent(holder.db, { firstName: 'Ada', lastName: 'L', courseIds: [course.id] })
  const a = gb.createAssignment(holder.db, { courseId: course.id, name: 'Essay', maxPoints: 10, weight: 1, dueDate: '2026-10-24', stemIds: [] })
  gb.setRawScore(holder.db, { assignmentId: a.id, studentId: s.id, rawScore: 8 })
  return { holder, course, s, a }
}

describe('persistence', () => {
  it('data survives closing and reopening the database', () => {
    const path = join(tempDir(), 'g.sqlite')
    const { holder, course } = seed(path)
    holder.close()
    const again = new DbHolder(path, join(path, '..', 'backups'))
    expect(again.open()).toMatchObject({ from: MIGRATIONS.length, to: MIGRATIONS.length })
    expect(gb.getGradebook(again.db, course.id).scores).toHaveLength(1)
    again.close()
  })
})

describe('migrations', () => {
  it('fresh database gets schema and seeds, no backup', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'g.sqlite'))
    const report = runMigrations(db, join(dir, 'backups'))
    expect(report.backupPath).toBeNull()
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect((db.prepare('SELECT COUNT(*) AS n FROM stems').get() as { n: number }).n).toBe(10)
    db.close()
  })

  it('upgrade preserves data and writes a verified pre-migration backup', () => {
    const path = join(tempDir(), 'g.sqlite')
    const { holder } = seed(path)
    holder.close()
    const db = openDatabase(path)
    const report = runMigrations(db, join(path, '..', 'backups'), [...MIGRATIONS, v2])
    expect(report.from).toBe(MIGRATIONS.length)
    expect(report.to).toBe(NEXT)
    expect(userVersion(db)).toBe(NEXT)
    expect((db.prepare('SELECT COUNT(*) AS n FROM grades').get() as { n: number }).n).toBe(1)
    expect(report.backupPath && existsSync(report.backupPath)).toBe(true)
    expect(validateDatabaseFile(report.backupPath!)).toBe(MIGRATIONS.length)
    db.close()
  })

  it('failed migration rolls back completely and reports a clear error', () => {
    const path = join(tempDir(), 'g.sqlite')
    const { holder } = seed(path)
    holder.close()
    const db = openDatabase(path)
    expect(() => runMigrations(db, join(path, '..', 'backups'), [...MIGRATIONS, badV2])).toThrow(/rolled back/)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    const cols = db.prepare('PRAGMA table_info(students)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).not.toContain('nickname')
    expect((db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n).toBe(1)
    db.close()
  })

  it('refuses a database from a newer app version without changing it', () => {
    const path = join(tempDir(), 'g.sqlite')
    const { holder } = seed(path)
    holder.close()
    const db = openDatabase(path)
    db.exec('PRAGMA user_version = 99')
    expect(() => runMigrations(db, join(path, '..', 'backups'))).toThrow(/newer/)
    expect(userVersion(db)).toBe(99)
    db.close()
  })

  it('prunes automatic backups to the newest N but never the only one', () => {
    const dir = tempDir()
    for (let i = 0; i < 5; i++) {
      const f = join(dir, `pre-migration-${i}.sqlite`)
      writeFileSync(f, 'x')
      utimesSync(f, new Date(2024, 0, i + 1), new Date(2024, 0, i + 1))
    }
    pruneBackups(dir, 'pre-migration-', 2)
    expect(readdirSync(dir).sort()).toEqual(['pre-migration-3.sqlite', 'pre-migration-4.sqlite'])
    pruneBackups(dir, 'pre-migration-', 0)
    expect(readdirSync(dir)).toHaveLength(1)
  })
})

describe('backup and restore', () => {
  it('backup preserves data and restore brings it back, with a safety backup', () => {
    const dir = tempDir()
    const { holder, course, s, a } = seed(join(dir, 'g.sqlite'))
    const backup = join(dir, 'manual.sqlite')
    holder.backupTo(backup)
    expect(validateDatabaseFile(backup)).toBe(MIGRATIONS.length)

    gb.setRawScore(holder.db, { assignmentId: a.id, studentId: s.id, rawScore: 2 })
    students.createStudent(holder.db, { firstName: 'New', lastName: 'Kid', courseIds: [course.id] })

    holder.restoreFrom(backup)
    const g = gb.getGradebook(holder.db, course.id)
    expect(g.scores[0]?.rawScore).toBe(8)
    expect(g.students).toHaveLength(1)
    const safety = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('pre-restore-'))
    expect(safety).toHaveLength(1)
    // the safety copy holds the pre-restore state (2 students, score 2)
    const safe = openDatabase(join(dir, 'backups', safety[0]!), { readOnly: true })
    expect((safe.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n).toBe(2)
    safe.close()
    holder.close()
  })

  it('rejects invalid, foreign, and newer backups and leaves current data intact', () => {
    const dir = tempDir()
    const { holder, course } = seed(join(dir, 'g.sqlite'))
    const garbage = join(dir, 'garbage.sqlite')
    writeFileSync(garbage, 'this is not a database at all')
    expect(() => holder.restoreFrom(garbage)).toThrow(/not a readable/)

    const foreign = join(dir, 'foreign.sqlite')
    const f = openDatabase(foreign)
    f.exec('CREATE TABLE x (a); PRAGMA user_version = 1')
    f.close()
    expect(() => holder.restoreFrom(foreign)).toThrow(/not a CBE Gradebook/)

    const unversioned = join(dir, 'plain.sqlite')
    const u = openDatabase(unversioned)
    u.exec('CREATE TABLE x (a)')
    u.close()
    expect(() => holder.restoreFrom(unversioned)).toThrow()

    const newer = join(dir, 'newer.sqlite')
    holder.backupTo(newer)
    const n = openDatabase(newer)
    n.exec('PRAGMA user_version = 50')
    n.close()
    expect(() => holder.restoreFrom(newer)).toThrow(/newer/)
    expect(() => holder.restoreFrom(join(dir, 'missing.sqlite'))).toThrow(/does not exist/)

    expect(gb.getGradebook(holder.db, course.id).scores).toHaveLength(1)
    holder.close()
  })

  it('restoring an older-schema backup migrates it afterwards', () => {
    const dir = tempDir()
    const { holder } = seed(join(dir, 'g.sqlite'))
    const backup = join(dir, 'old.sqlite')
    holder.backupTo(backup)
    holder.close()
    const upgraded = new DbHolder(join(dir, 'g.sqlite'), join(dir, 'backups'), [...MIGRATIONS, v2])
    upgraded.open()
    upgraded.restoreFrom(backup)
    expect(userVersion(upgraded.db)).toBe(NEXT)
    upgraded.close()
  })
})
