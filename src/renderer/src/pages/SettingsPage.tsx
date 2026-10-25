import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Stem, Subject } from '@shared/types'
import { useConfirm } from '../components/Modal'
import { useStatus } from '../components/Status'
import { errorMessage, useLoad } from '../hooks'

function StemRow({ stem, first, last, onChange }: { stem: Stem; first: boolean; last: boolean; onChange: (stems: Stem[]) => void }) {
  const status = useStatus()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(stem.name)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: Promise<Stem[]>) => {
    try {
      onChange(await status.track(work))
      setError(null)
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    }
  }
  const rename = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(window.api.renameStem({ id: stem.id, name }))) setEditing(false)
  }
  const toggle = async () => {
    if (stem.active) {
      const ok = await confirm({
        title: 'Deactivate stem?',
        message: `“${stem.name}” won’t be offered for new assignments. Existing assignments keep it and past averages stay the same.`,
        confirmLabel: 'Deactivate'
      })
      if (!ok) return
    }
    void run(window.api.setStemActive({ id: stem.id, active: !stem.active }))
  }

  return (
    <li className={stem.active ? 'stem-row' : 'stem-row inactive'}>
      {editing ? (
        <form onSubmit={rename} className="inline-form">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Stem name" autoFocus />
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => { setEditing(false); setName(stem.name); setError(null) }}>Cancel</button>
        </form>
      ) : (
        <>
          <span className="stem-name">{stem.name}{!stem.active && <span className="badge">Inactive</span>}</span>
          <span className="stem-actions">
            <button aria-label={`Move ${stem.name} up`} disabled={first} onClick={() => void run(window.api.moveStem({ id: stem.id, direction: 'up' }))}>↑</button>
            <button aria-label={`Move ${stem.name} down`} disabled={last} onClick={() => void run(window.api.moveStem({ id: stem.id, direction: 'down' }))}>↓</button>
            <button onClick={() => setEditing(true)}>Rename</button>
            <button onClick={() => void toggle()}>{stem.active ? 'Deactivate' : 'Activate'}</button>
          </span>
        </>
      )}
      {error && <span className="field-error" role="alert">{error}</span>}
    </li>
  )
}

function SubjectStems({ subject, stems, onChange }: { subject: Subject; stems: Stem[]; onChange: (stems: Stem[]) => void }) {
  const status = useStatus()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      onChange(await status.track(window.api.createStem({ subjectId: subject.id, name })))
      setName('')
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <div className="subject-stems">
      <h3>{subject.name}</h3>
      <ul className="stem-list">
        {stems.map((s, i) => <StemRow key={s.id} stem={s} first={i === 0} last={i === stems.length - 1} onChange={onChange} />)}
      </ul>
      <form onSubmit={add} className="inline-form" noValidate>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New stem name" aria-label={`New ${subject.name} stem`} />
        <button type="submit">Add stem</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}

export function SettingsPage() {
  const info = useLoad(() => window.api.getAppInfo(), [])
  const subjects = useLoad(() => window.api.listSubjects(), [])
  const stems = useLoad(() => window.api.listStems(), [])
  const status = useStatus()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const backup = async () => {
    setBusy(true)
    try {
      const r = await window.api.createBackup()
      if (r.saved) status.notify(`Backup saved to ${r.path}`)
    } catch (e) {
      status.fail(errorMessage(e))
    }
    setBusy(false)
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restore from a backup?',
      message: 'You will choose a backup file. It is checked first, your current data is saved to a safety backup, and then the app reloads with the restored data.',
      confirmLabel: 'Choose file…',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await window.api.restoreBackup()
      if (r.restored) {
        window.location.reload()
        return
      }
    } catch (e) {
      status.fail(errorMessage(e))
    }
    setBusy(false)
  }

  const changeStems = (next: Stem[]) => stems.setData(() => next)

  return (
    <div className="settings">
      <header className="page-head"><h1>Settings / Backups</h1></header>

      <section className="panel" aria-labelledby="data-h">
        <h2 id="data-h">Your data</h2>
        {info.data && (
          <dl className="facts">
            <dt>Database file</dt><dd><code>{info.data.databasePath}</code></dd>
            <dt>Automatic backups folder</dt><dd><code>{info.data.backupDirectory}</code></dd>
            <dt>Schema version</dt><dd>{info.data.schemaVersion}</dd>
            <dt>App version</dt><dd>{info.data.version}</dd>
          </dl>
        )}
        <p className="hint">Everything is stored on this computer only. Nothing is uploaded.</p>
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void backup()}>Create backup…</button>
          <button disabled={busy} onClick={() => void restore()}>Restore backup…</button>
        </div>
        <p className="hint">The app also makes a safety copy automatically before upgrading its database and before any restore (the newest 10 are kept).</p>
        {info.data && info.data.autoBackups.length > 0 && (
          <details>
            <summary>Automatic backups ({info.data.autoBackups.length})</summary>
            <ul className="plain">
              {info.data.autoBackups.map((b) => <li key={b.name}><code>{b.name}</code> <span className="muted small">{new Date(b.modified).toLocaleString()}</span></li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="panel" aria-labelledby="stems-h">
        <h2 id="stems-h">Learning stems</h2>
        <p className="hint">Stems are the learning categories for each subject. Deactivating a stem hides it from new assignments but keeps existing links and results. Stems that have been used can’t be deleted.</p>
        {stems.error && <p className="field-error" role="alert">{stems.error}</p>}
        {(subjects.data ?? []).map((subject) => (
          <SubjectStems key={subject.id} subject={subject} stems={(stems.data ?? []).filter((s) => s.subjectId === subject.id)} onChange={changeStems} />
        ))}
      </section>

      <section className="panel" aria-labelledby="csv-h">
        <h2 id="csv-h">CSV import and export</h2>
        <p>
          <strong>Roster import</strong> (Students → Import CSV) reads a UTF-8 CSV with a header row containing <code>first_name</code> and <code>last_name</code>.
          You preview every row, review possible duplicate names, and choose the courses to enrol in.
        </p>
        <p><strong>Export</strong> is on each gradebook tab (“Export CSV”) and saves the view you are looking at.</p>
        <p className="hint">Importing old spreadsheets is not supported. Database backups and roster CSV files are the supported import paths.</p>
      </section>
    </div>
  )
}
