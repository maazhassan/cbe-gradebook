import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { AppError, openDatabase, userVersion } from './connection'
import type { Db } from './connection'
import { MIGRATIONS } from './migrations'
import type { Migration } from './migrations'

const REQUIRED_TABLES = ['subjects', 'stems', 'students', 'courses', 'course_enrollments', 'assignments', 'assignment_stems', 'grades']
export const KEEP_AUTOMATIC_BACKUPS = 10

export const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

/**
 * Check that `path` is an intact SQLite file with this app's schema and a schema version
 * this app understands. Returns the file's schema version; throws AppError otherwise.
 */
export function validateDatabaseFile(path: string, migrations: readonly Migration[] = MIGRATIONS): number {
  if (!existsSync(path)) throw new AppError('The selected file does not exist.')
  let db: Db | null = null
  try {
    db = openDatabase(path, { readOnly: true })
    const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new AppError('The file failed the SQLite integrity check, so it was not used.')
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new AppError('The file has broken references between records, so it was not used.')
    }
    const version = userVersion(db)
    const latest = migrations[migrations.length - 1]?.version ?? 0
    if (version < 1) throw new AppError('This file is not a CBE Gradebook database.')
    if (version > latest) {
      throw new AppError(`This backup was made by a newer version of the app (schema ${version}; this app supports up to ${latest}).`)
    }
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
    )
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t))
    if (missing.length) throw new AppError(`This file is not a CBE Gradebook database (missing: ${missing.join(', ')}).`)
    return version
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('The selected file is not a readable SQLite database.')
  } finally {
    db?.close()
  }
}

/** Consistent single-file copy of a live database (VACUUM INTO), verified after writing. */
export function createBackupFile(db: Db, destination: string, migrations: readonly Migration[] = MIGRATIONS): void {
  mkdirSync(dirname(destination), { recursive: true })
  rmSync(destination, { force: true })
  try {
    db.prepare('VACUUM INTO ?').run(destination)
    validateDatabaseFile(destination, migrations)
  } catch (error) {
    rmSync(destination, { force: true })
    throw error instanceof AppError ? error : new AppError(`Backup failed: ${(error as Error).message}`)
  }
}

/** Keep the newest `keep` files starting with `prefix`; never delete the only backup. */
export function pruneBackups(dir: string, prefix: string, keep = KEEP_AUTOMATIC_BACKUPS): void {
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.sqlite'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f))
  if (files.length <= 1) return
  for (const old of files.slice(Math.max(keep, 1))) rmSync(join(dir, old.f), { force: true })
}

export function listAutomaticBackups(dir: string): { name: string; modified: string }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => ({ name: f, modified: statSync(join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => b.modified.localeCompare(a.modified))
}

/**
 * Stage a validated copy of `source` next to the live database, ready to be swapped in.
 * Going through VACUUM INTO also folds in any WAL data and never touches the source file.
 */
export function stageRestore(source: string, dbPath: string, migrations: readonly Migration[] = MIGRATIONS): string {
  validateDatabaseFile(source, migrations)
  const staged = join(dirname(dbPath), `.restore-staging-${basename(dbPath)}`)
  rmSync(staged, { force: true })
  const src = openDatabase(source, { readOnly: true })
  try {
    src.prepare('VACUUM INTO ?').run(staged)
  } finally {
    src.close()
  }
  try {
    validateDatabaseFile(staged, migrations)
  } catch (error) {
    rmSync(staged, { force: true })
    throw error
  }
  return staged
}

export function replaceDatabaseFile(dbPath: string, replacement: string): void {
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  renameSync(replacement, dbPath)
}

export function copyDatabaseFile(from: string, to: string): void {
  copyFileSync(from, to)
}
