import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError, openDatabase, transaction, userVersion } from './connection'
import type { Db } from './connection'
import { createBackupFile, copyDatabaseFile, pruneBackups, replaceDatabaseFile, stageRestore, timestamp } from './backup'
import { MIGRATIONS } from './migrations'
import type { Migration } from './migrations'
import { rmSync } from 'node:fs'

export class MigrationError extends AppError {}

export interface MigrationReport {
  from: number
  to: number
  backupPath: string | null
}

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations[migrations.length - 1]?.version ?? 0
}

/**
 * Bring `db` to the latest schema. Existing data is backed up (verified) first; all pending
 * migrations then apply in a single transaction so a failure changes nothing.
 */
export function runMigrations(
  db: Db,
  backupDir: string,
  migrations: readonly Migration[] = MIGRATIONS
): MigrationReport {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new MigrationError('Migration list is not sequential from 1.')
  })
  const current = userVersion(db)
  const latest = latestVersion(migrations)
  if (current > latest) {
    throw new MigrationError(
      `This database (schema ${current}) was created by a newer version of the app (supports up to ${latest}). Update the app; the database was not changed.`
    )
  }
  if (current === latest) return { from: current, to: latest, backupPath: null }

  let backupPath: string | null = null
  if (current > 0) {
    backupPath = join(backupDir, `pre-migration-v${current}-to-v${latest}-${timestamp()}.sqlite`)
    try {
      createBackupFile(db, backupPath, migrations)
    } catch (error) {
      throw new MigrationError(`Could not create the pre-migration backup, so the database was not upgraded. ${(error as Error).message}`)
    }
    pruneBackups(backupDir, 'pre-migration-')
  }

  const pending = migrations.filter((m) => m.version > current)
  try {
    transaction(db, () => {
      for (const m of pending) {
        db.exec(m.sql)
        db.exec(`PRAGMA user_version = ${m.version}`)
      }
      const violations = db.prepare('PRAGMA foreign_key_check').all()
      if (violations.length) throw new Error('foreign key check failed after migration')
    })
  } catch (error) {
    throw new MigrationError(
      `Upgrading the database failed and was rolled back: ${(error as Error).message}.` +
        (backupPath ? ` A backup of your data is at ${backupPath}.` : '')
    )
  }
  return { from: current, to: latest, backupPath }
}

/** Owns the live connection so Restore can close and reopen it safely. */
export class DbHolder {
  private current: Db | null = null
  constructor(
    readonly dbPath: string,
    readonly backupDir: string,
    private readonly migrations: readonly Migration[] = MIGRATIONS
  ) {}

  get db(): Db {
    if (!this.current) throw new AppError('The database is not open.')
    return this.current
  }

  open(): MigrationReport {
    mkdirSync(dirname(this.dbPath), { recursive: true })
    const db = openDatabase(this.dbPath)
    try {
      const report = runMigrations(db, this.backupDir, this.migrations)
      this.current = db
      return report
    } catch (error) {
      db.close()
      throw error
    }
  }

  close(): void {
    this.current?.close()
    this.current = null
  }

  backupTo(destination: string): void {
    createBackupFile(this.db, destination, this.migrations)
  }

  /** Validate, safety-backup, then swap in `source`. On any failure the old database stays live. */
  restoreFrom(source: string): void {
    const staged = stageRestore(source, this.dbPath, this.migrations)
    const safety = join(this.backupDir, `pre-restore-${timestamp()}.sqlite`)
    try {
      createBackupFile(this.db, safety, this.migrations)
    } catch (error) {
      rmSync(staged, { force: true })
      throw error
    }
    this.close()
    try {
      replaceDatabaseFile(this.dbPath, staged)
      this.open()
    } catch (error) {
      // roll back to the pre-restore copy
      this.close()
      rmSync(`${this.dbPath}-wal`, { force: true })
      rmSync(`${this.dbPath}-shm`, { force: true })
      copyDatabaseFile(safety, this.dbPath)
      this.open()
      throw new AppError(`Restore failed and your previous data was kept: ${(error as Error).message}`)
    }
    pruneBackups(this.backupDir, 'pre-restore-')
  }
}
