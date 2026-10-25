import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export class AppError extends Error {}

export function openDatabase(path: string, options: { readOnly?: boolean } = {}): Db {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false })
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  if (!options.readOnly && path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  return db
}

/** Runs `fn` in a transaction (re-entrant: joins an outer transaction if one is open). */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // connection already rolled back
    }
    throw error
  }
}

export function userVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}
