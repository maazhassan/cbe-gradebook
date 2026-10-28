import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, dialog, globalShortcut, session } from 'electron'
import icon from '../../build/icon.png?asset'
import { AppError, userVersion } from './db/connection'
import { listAutomaticBackups, timestamp } from './db/backup'
import { DbHolder } from './db/holder'
import { registerIpc } from './ipc'
import { armMacro, cancelMacro, prepareLinuxGlobalShortcuts, resetLinuxShortcutBinding } from './macro'
import type { Handlers } from './ipc'
import * as stems from './services/stems'
import * as courses from './services/courses'
import * as students from './services/students'
import * as gradebook from './services/gradebook'
import * as logEntries from './services/logEntries'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
let mainWindow: BrowserWindow | null = null
let holder: DbHolder

function buildHandlers(): Handlers {
  const db = () => holder.db
  const parent = () => mainWindow ?? undefined
  return {
    getAppInfo: () => ({
      version: app.getVersion(),
      schemaVersion: userVersion(db()),
      databasePath: holder.dbPath,
      backupDirectory: holder.backupDir,
      autoBackups: listAutomaticBackups(holder.backupDir)
    }),
    listSubjects: () => stems.listSubjects(db()),
    listStems: () => stems.listStems(db()),
    createStem: (i) => stems.createStem(db(), i),
    renameStem: (i) => stems.renameStem(db(), i),
    setStemActive: (i) => stems.setStemActive(db(), i),
    moveStem: (i) => stems.moveStem(db(), i),
    listCourses: () => courses.listCourses(db()),
    createCourse: (i) => courses.createCourse(db(), i),
    updateCourse: (i) => courses.updateCourse(db(), i),
    setCourseArchived: (i) => courses.setCourseArchived(db(), i),
    listStudents: () => students.listStudents(db()),
    getStudent: (i) => students.getStudent(db(), i),
    createStudent: (i) => students.createStudent(db(), i),
    updateStudent: (i) => students.updateStudent(db(), i),
    setStudentArchived: (i) => students.setStudentArchived(db(), i),
    updateStudentComments: (i) => students.updateStudentComments(db(), i),
    setEnrollment: (i) => students.setEnrollment(db(), i),
    importRoster: (i) => students.importRoster(db(), i),
    getGradebook: (i) => gradebook.getGradebook(db(), i),
    createAssignment: (i) => gradebook.createAssignment(db(), i),
    updateAssignment: (i) => gradebook.updateAssignment(db(), i),
    archiveAssignment: (i) => gradebook.archiveAssignment(db(), i),
    unarchiveAssignment: (i) => gradebook.unarchiveAssignment(db(), i),
    listArchivedAssignments: (i) => gradebook.listArchivedAssignments(db(), i),
    setRawScore: (i) => gradebook.setRawScore(db(), i),
    enrollStudents: ({ courseId, studentIds }) => {
      for (const studentId of studentIds) students.setEnrollment(db(), { studentId, courseId, active: true })
    },
    getStudentDashboard: (i) => gradebook.getStudentDashboard(db(), i),
    listLogEntries: (i) => logEntries.listLogEntries(db(), i),
    createLogEntry: (i) => logEntries.createLogEntry(db(), i),
    updateLogEntry: (i) => logEntries.updateLogEntry(db(), i),
    setLogEntryArchived: (i) => logEntries.setLogEntryArchived(db(), i),

    createBackup: async () => {
      const options = {
        title: 'Create backup',
        defaultPath: join(app.getPath('documents'), `cbe-gradebook-backup-${timestamp().slice(0, 10)}.sqlite`),
        filters: [{ name: 'SQLite database', extensions: ['sqlite'] }]
      }
      const result = parent() ? await dialog.showSaveDialog(parent()!, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false as const }
      holder.backupTo(result.filePath)
      return { saved: true as const, path: result.filePath }
    },
    restoreBackup: async () => {
      const options = {
        title: 'Choose a backup to restore',
        properties: ['openFile' as const],
        filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db', 'sqlite3'] }]
      }
      const picked = parent() ? await dialog.showOpenDialog(parent()!, options) : await dialog.showOpenDialog(options)
      const file = picked.filePaths[0]
      if (picked.canceled || !file) return { restored: false as const }
      const confirm = {
        type: 'warning' as const,
        buttons: ['Cancel', 'Restore'],
        defaultId: 0,
        cancelId: 0,
        title: 'Restore backup',
        message: 'Replace all current data with this backup?',
        detail: `${file}\n\nYour current data is saved to a safety backup first, so this can be undone.`
      }
      const answer = parent() ? await dialog.showMessageBox(parent()!, confirm) : await dialog.showMessageBox(confirm)
      if (answer.response !== 1) return { restored: false as const }
      holder.restoreFrom(file)
      return { restored: true as const, path: file }
    },
    saveTextFile: async ({ defaultName, content }) => {
      const safeName = defaultName.replace(/[\\/:*?"<>|]+/g, '-')
      const options = { title: 'Export CSV', defaultPath: join(app.getPath('documents'), safeName), filters: [{ name: 'CSV', extensions: ['csv'] }] }
      const result = parent() ? await dialog.showSaveDialog(parent()!, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false as const }
      writeFileSync(result.filePath, '\uFEFF' + content, 'utf8')
      return { saved: true as const, path: result.filePath }
    },
    pickRosterFile: async () => {
      const options = { title: 'Choose a roster CSV', properties: ['openFile' as const], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] }
      const picked = parent() ? await dialog.showOpenDialog(parent()!, options) : await dialog.showOpenDialog(options)
      const file = picked.filePaths[0]
      if (picked.canceled || !file) return null
      if (statSync(file).size > 5_000_000) throw new AppError('That file is too large to be a class roster.')
      return { name: file.split(/[\\/]/).pop() ?? file, text: readFileSync(file, 'utf8') }
    },
    armTypingMacro: ({ values, label }) => {
      if (!mainWindow) throw new AppError('The gradebook window is not open.')
      return armMacro(values, label, mainWindow.webContents)
    },
    disarmTypingMacro: () => cancelMacro()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 600, show: false,
    title: 'CBE Gradebook', icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!(isDev && url.startsWith(process.env['ELECTRON_RENDERER_URL']!))) event.preventDefault()
  })
  if (isDev) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function lockDownNetwork(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const local = url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('data:') ||
      (isDev && (url.startsWith(process.env['ELECTRON_RENDERER_URL']!) || url.startsWith('ws://localhost')))
    callback({ cancel: !local })
  })
}

prepareLinuxGlobalShortcuts()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    resetLinuxShortcutBinding()
    lockDownNetwork()
    // No File/Edit/View/Window bar in the packaged app. Kept in dev (reload, DevTools) and on macOS, where the menu
    // lives in the system bar and is needed for Cmd+C/V/Q.
    if (!isDev && process.platform !== 'darwin') Menu.setApplicationMenu(null)
    const dir = app.getPath('userData')
    holder = new DbHolder(join(dir, 'gradebook.sqlite'), join(dir, 'backups'))
    try {
      holder.open()
    } catch (error) {
      dialog.showErrorBox('CBE Gradebook could not open its database', (error as Error).message)
      app.exit(1)
      return
    }
    registerIpc(buildHandlers())
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', () => {
    cancelMacro()
    globalShortcut.unregisterAll()
  })
  app.on('before-quit', () => {
    try {
      holder?.close()
    } catch {
      // already closed
    }
  })
}

