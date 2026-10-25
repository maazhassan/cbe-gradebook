import { openDatabase } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { runMigrations } from '../src/main/db/holder'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as stems from '../src/main/services/stems'
import * as courses from '../src/main/services/courses'
import * as students from '../src/main/services/students'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gradebook-test-'))
}

export function memoryDb(): Db {
  const db = openDatabase(':memory:')
  runMigrations(db, tempDir())
  return db
}

export function subjectId(db: Db, name: string): number {
  return stems.listSubjects(db).find((s) => s.name === name)!.id
}

export function stemId(db: Db, subject: string, name: string): number {
  const sid = subjectId(db, subject)
  return stems.listStems(db).find((s) => s.subjectId === sid && s.name === name)!.id
}

export function setup(db: Db) {
  const ela = courses.createCourse(db, { name: 'ELA 8A', subjectId: subjectId(db, 'ELA') })
  const social = courses.createCourse(db, { name: 'Social 8A', subjectId: subjectId(db, 'Social Studies') })
  const ada = students.createStudent(db, { firstName: 'Ada', lastName: 'Lovelace', courseIds: [ela.id, social.id] })
  const ben = students.createStudent(db, { firstName: 'Ben', lastName: 'Okafor', courseIds: [ela.id] })
  return { ela, social, ada, ben }
}
