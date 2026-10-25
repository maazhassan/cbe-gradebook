import { AppError, transaction } from '../db/connection'
import type { Db } from '../db/connection'
import type { Stem, Subject } from '@shared/types'

interface StemRow { id: number; subject_id: number; name: string; display_order: number; active: number }

const toStem = (r: StemRow): Stem => ({
  id: r.id, subjectId: r.subject_id, name: r.name, displayOrder: r.display_order, active: r.active === 1
})

export function listSubjects(db: Db): Subject[] {
  return db.prepare('SELECT id, name FROM subjects ORDER BY id').all() as unknown as Subject[]
}

export function listStems(db: Db): Stem[] {
  const rows = db.prepare('SELECT * FROM stems ORDER BY subject_id, display_order, id').all() as unknown as StemRow[]
  return rows.map(toStem)
}

function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new AppError('Stem name is required.')
  if (trimmed.length > 60) throw new AppError('Stem name must be 60 characters or fewer.')
  return trimmed
}

function assertNameFree(db: Db, subjectId: number, name: string, exceptId = 0): void {
  const clash = db
    .prepare('SELECT id FROM stems WHERE subject_id = ? AND name = ? AND id <> ?')
    .get(subjectId, name, exceptId)
  if (clash) throw new AppError(`This subject already has a stem named “${name}”.`)
}

function getStemRow(db: Db, id: number): StemRow {
  const row = db.prepare('SELECT * FROM stems WHERE id = ?').get(id) as StemRow | undefined
  if (!row) throw new AppError('Stem not found.')
  return row
}

export function createStem(db: Db, input: { subjectId: number; name: string }): Stem[] {
  const name = cleanName(input.name)
  transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(input.subjectId)) throw new AppError('Subject not found.')
    assertNameFree(db, input.subjectId, name)
    const next = db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM stems WHERE subject_id = ?').get(input.subjectId) as { n: number }
    db.prepare('INSERT INTO stems (subject_id, name, display_order) VALUES (?, ?, ?)').run(input.subjectId, name, next.n)
  })
  return listStems(db)
}

export function renameStem(db: Db, input: { id: number; name: string }): Stem[] {
  const name = cleanName(input.name)
  transaction(db, () => {
    const row = getStemRow(db, input.id)
    assertNameFree(db, row.subject_id, name, row.id)
    db.prepare("UPDATE stems SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(name, input.id)
  })
  return listStems(db)
}

export function setStemActive(db: Db, input: { id: number; active: boolean }): Stem[] {
  getStemRow(db, input.id)
  db.prepare("UPDATE stems SET active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(input.active ? 1 : 0, input.id)
  return listStems(db)
}

export function moveStem(db: Db, input: { id: number; direction: 'up' | 'down' }): Stem[] {
  transaction(db, () => {
    const row = getStemRow(db, input.id)
    const siblings = db.prepare('SELECT id FROM stems WHERE subject_id = ? ORDER BY display_order, id').all(row.subject_id) as { id: number }[]
    const ids = siblings.map((s) => s.id)
    const i = ids.indexOf(input.id)
    const j = input.direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    const update = db.prepare('UPDATE stems SET display_order = ? WHERE id = ?')
    ids.forEach((id, index) => update.run(index + 1, id))
  })
  return listStems(db)
}
