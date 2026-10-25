# CBE Gradebook

Offline desktop gradebook for a Grade 8 ELA / Social Studies teacher (Calgary, AB). Enter raw scores once per course; PowerSchool grades (1–4) and weighted stem averages are always *derived*, never stored. All data lives in a local SQLite file. There is no network access, account, telemetry or cloud component.

## Features

- **Gradebooks**: course selector with three synchronized tabs — *Raw Scores* (the only editable view), *PowerSchool Grades*, *Weighted Stem Averages* (both read-only). Inline cell editing (Tab/Shift+Tab, Enter saves and moves down, Esc cancels, blur saves, arrows move), saved/saving/error indicator, add/edit/archive assignments, add or create students without leaving the page, CSV export of the current tab.
- **Students**: searchable list, add/edit/archive/reactivate, course enrolment, three autosaving report-card comments, and a read-only dashboard of grades and stem averages across every course (archived/inactive history is labelled). Roster CSV import with preview and duplicate review.
- **Courses**: add/rename/archive/reactivate; stems come from the subject in the database.
- **Settings / Backups**: database location, create/restore backup, learning-stem management (add, rename, reorder, deactivate — never hard-deleted).

## Grading rules (src/shared/grading.ts)

- Percent = score / max × 100 (never rounded before comparing). ≥90 → 4, ≥70 → 3, ≥50 → 2, else 1. Blank score → blank (not zero).
- Stem average = Σ(grade × weight) / Σ(weight) over that student's *graded* assignments linked to the stem, rounded half-up to 2 decimals; blank if nothing graded. Weights are relative, and an assignment with several stems counts fully toward each.
- Scores must be between 0 and max inclusive; max points > 0; weight is an integer ≥ 1.

## Architecture

```
src/shared/     pure TypeScript: grading rules, CSV, CSV export builders, IPC types (used by main + renderer + tests)
src/main/       Electron main process: SQLite (node:sqlite), migrations, backup/restore, services, zod-validated IPC
src/preload/    contextBridge exposing ONLY the named operations in API_METHODS (no SQL, no Node)
src/renderer/   React UI (plain CSS, no state library)
tests/          Vitest: grading, CSV, services (against real SQLite), migrations, backup/restore
```

- Security: `contextIsolation` on, `nodeIntegration` off, renderer sandboxed, strict CSP (`default-src 'none'`, no remote anything), navigation/new windows denied, every non-local network request cancelled, all IPC arguments validated with zod.
- Database access is only in the main process, with prepared statements, foreign keys on, and transactions for multi-step writes. Cross-table rules (score ≤ max, student belongs to the course, stems match the course's subject, subject immutability) are also enforced by SQL triggers as a backstop to the service checks.
- Derived values are computed in the renderer/export code from raw data using the same functions that the tests cover, so the three views, the dashboard and CSV exports cannot disagree.
- **SQLite driver**: Node's built-in `node:sqlite` (Electron 45 bundles Node 24), instead of `better-sqlite3`. This avoids any native-module rebuilding for Electron vs. Node, and tests run on the same engine as the app. Trade-off: `node:sqlite` is flagged "active development" upstream; Electron is pinned to an exact version so its behaviour can't shift under you.
- Not implemented (by design for this version): per-assignment reordering UI, restoring an archived assignment from the UI (the data is kept), and any PowerSchool/Google/LLM integration.

## Commands

```sh
npm install
npm run dev            # Electron + Vite with hot reload
npm test               # Vitest
npm run typecheck      # tsc for main/shared/tests and for the renderer
npm run lint
npm run build          # typecheck + production build into out/
npm run start          # run the production build
npm run check          # typecheck + lint + tests + build
npm run package:linux  # unpacked Linux app in release/
npm run package:mac    # .dmg and .zip (run this on a Mac)
```

If your shell exports `ELECTRON_RUN_AS_NODE=1` (some tooling does), `npm run dev` will crash with "Cannot read properties of undefined (reading 'isPackaged')". Run `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Data location and backups

- Database: `gradebook.sqlite` in Electron's `userData` folder (Linux: `~/.config/<app name>/`, macOS: `~/Library/Application Support/<app name>/`; the app name is `cbe-gradebook` in dev and `CBE Gradebook` when packaged). The exact path is shown in **Settings / Backups**.
- Automatic safety backups go to `backups/` next to it (`pre-migration-*` before schema upgrades and `pre-restore-*` before restores; newest 10 of each kept, the only backup is never deleted).
- **Create backup**: pick a file; the app writes a consistent single-file copy (`VACUUM INTO`) and verifies it.
- **Restore backup**: pick a file → native confirmation → the file is checked (SQLite integrity check, foreign-key check, this app's tables, schema version not newer than the app) → your current data is saved to a `pre-restore-*` safety backup → the database is swapped and reopened (older backups are upgraded by the normal migration path) → the UI reloads. Invalid files are rejected and current data is left untouched; if the swap fails the previous data is put back.
- Supported import paths: database backups and roster CSV (`first_name,last_name` header, extra columns ignored). Arbitrary old spreadsheets are not imported.

## Migrations

Forward-only, in `src/main/db/migrations.ts`, versioned with `PRAGMA user_version`. To change the schema, **append** a migration; never edit a released one. On start: a newer-than-known database is refused untouched; if migrations are pending and data exists, a verified `pre-migration-*` backup is written first; all pending migrations then run in one transaction, so a failure rolls everything back and shows a clear error (the app does not start on a half-migrated database). Don't use `PRAGMA foreign_keys` or `BEGIN/COMMIT` inside migration SQL.

## macOS packaging notes

Run `npm run package:mac` on a Mac (no native modules, so no rebuild step). Unsigned builds trigger Gatekeeper: right-click → Open the first time, or sign/notarise with an Apple developer account (set `CSC_LINK`/`CSC_KEY_PASSWORD` and the notarisation variables for electron-builder). Add an `icon.icns` via `build.mac.icon` if you want a custom icon. **The macOS build has not been tested** (developed and tested on Arch Linux only).

## Verification status

- Passing: unit/integration tests, both type-checks, ESLint, production build, `electron-builder --linux dir`.
- Manually exercised on Linux via the built app and dev mode: course/student/assignment creation, grid entry with valid and invalid scores, derived views, comment autosave (including flush when switching students), restart persistence.
- Not exercised: native file dialogs (Create/Restore backup, CSV export/import — their underlying logic is covered by tests, but the dialogs were not clicked through), the packaged Linux binary, and everything on macOS.
