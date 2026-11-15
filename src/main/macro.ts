import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, globalShortcut, systemPreferences } from 'electron'
import type { WebContents } from 'electron'
import { AppError } from './db/connection'
import type { MacroArmed, MacroEvent } from '@shared/types'

/**
 * "Type an assignment into another app": the renderer arms one PowerSchool grade per student, the user clicks the
 * top-left cell of the PowerTeacher sheet and presses the hotkey, and we fill in the whole sheet using only typing,
 * Enter and the arrow keys. The hotkey is registered only while armed, and is released when it fires, when the
 * timeout passes, or when the user cancels.
 *
 * The sheet has one row per student and (stems + 1) columns. The first column is the "collected" marker ("co", left
 * blank for a missing assignment); every other column holds the same grade.
 *
 * A value ending in "L" is a late score ("3L"); "MI" is a missing score, entered as the grade 1 with a marker. In both
 * cases PowerTeacher takes the grade and the marker in two steps: type the grade and press Enter, press Up to return to
 * the cell, then type the marker ("la" / "mi"). Enter does nothing on the last row, so there we use arrow keys
 * instead (leaving a cell that way commits it, like Enter): grade, Up, Down, marker.
 */

export const MACRO_ACCELERATOR = 'CommandOrControl+Alt+Shift+G'
const ARM_TIMEOUT_MS = 60_000
/** Pause between entries so the web page can move focus to the next field after Enter. */
const ENTRY_DELAY_MS = 80
const run = promisify(execFile)

let armed: { values: string[]; stems: number; label: string; timer: NodeJS.Timeout; target: WebContents } | null = null
let typing = false

const LINUX_APP_ID = 'cbe-gradebook'

/**
 * Wayland only allows global shortcuts through the xdg-desktop-portal, and the portal refuses ("An app id is
 * required") unless the app id matches an installed .desktop file. Without this, register() still returns true but
 * the hotkey never fires. Must run before the app is ready.
 */
export function prepareLinuxGlobalShortcuts(): void {
  if (process.platform !== 'linux') return
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
  app.setDesktopName(`${LINUX_APP_ID}.desktop`)
  const exec = process.env['APPIMAGE'] ?? process.execPath
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=CBE Gradebook',
    `Exec="${exec.replace(/(["`$\\])/g, '\\$1')}" %U`,
    'Categories=Education;',
    // Dev builds only need the entry for the portal; keep them out of the app menu.
    `NoDisplay=${app.isPackaged ? 'false' : 'true'}`,
    ''
  ].join('\n')
  const dir = join(process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'), 'applications')
  const file = join(dir, `${LINUX_APP_ID}.desktop`)
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === entry) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, entry)
  } catch (error) {
    console.error('[macro] could not install desktop entry', error)
  }
}

/**
 * Forget the hotkey binding KDE saved on the previous run. On relaunch Chromium sees the saved binding, skips binding
 * it again, and KDE then never delivers key presses to the new session, so the hotkey silently does nothing. With the
 * binding cleared, Chromium binds afresh and KDE asks the user to confirm it once per launch. Call once at startup,
 * after the single-instance check (a second instance must not clear the running app's binding).
 */
export function resetLinuxShortcutBinding(): void {
  if (process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] !== 'wayland') return
  const component = `/component/${LINUX_APP_ID.replace(/-/g, '_')}`
  // Fails harmlessly on desktops without kglobalaccel, or when nothing is saved yet.
  execFile('busctl', ['--user', 'call', 'org.kde.kglobalaccel', component, 'org.kde.kglobalaccel.Component', 'cleanUp'], () => {})
}

function send(target: WebContents, event: MacroEvent): void {
  if (!target.isDestroyed()) target.send('macro:event', event)
}

/**
 * On Linux the hotkey stays registered once bound: Chromium's Wayland portal backend binds the first registration
 * but never fires again after an unregister/register cycle. The handler ignores presses unless an assignment is armed,
 * so each arm still types at most once. macOS registers only while armed, so the key isn't taken from other apps.
 */
const KEEP_HOTKEY_REGISTERED = process.platform === 'linux'
let hotkeyRegistered = false

function registerHotkey(): boolean {
  if (!hotkeyRegistered) hotkeyRegistered = globalShortcut.register(MACRO_ACCELERATOR, onHotkey)
  return hotkeyRegistered
}

/** Release the hotkey. The ydotool daemon (if any) is left running; see cancelMacro. */
function disarmMacro(): void {
  if (!armed) return
  clearTimeout(armed.timer)
  if (!KEEP_HOTKEY_REGISTERED && hotkeyRegistered) {
    globalShortcut.unregister(MACRO_ACCELERATOR)
    hotkeyRegistered = false
  }
  armed = null
}

function onHotkey(): void {
  const current = armed
  if (!current) return
  disarmMacro()
  typing = true
  typeSheet(buildSteps(current.values, current.stems))
    .then(() => send(current.target, { kind: 'done', label: current.label, count: current.values.length }))
    .catch((error: unknown) => {
      console.error('[macro]', error)
      send(current.target, { kind: 'error', label: current.label, message: typingErrorMessage(error) })
    })
    .finally(() => {
      typing = false
      if (!armed) stopYdotoold()
    })
}

/** User cancelled, left the page, or the app is quitting. */
export function cancelMacro(): void {
  disarmMacro()
  if (!typing) stopYdotoold()
}

export function armMacro(values: string[], stems: number, label: string, target: WebContents): MacroArmed {
  if (typing) throw new AppError('Still typing the previous assignment. Wait for it to finish.')
  if (values.length === 0) throw new AppError('There are no students in this assignment.')
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    throw new AppError(
      'CBE Gradebook needs Accessibility permission to type into other apps. Allow it in System Settings → Privacy & Security → Accessibility, then try again.'
    )
  }
  disarmMacro()
  if (usesYdotool()) startYdotoold()
  if (!registerHotkey()) {
    stopYdotoold()
    throw new AppError('Could not register the hotkey. Another app may already be using it.')
  }
  const timer = setTimeout(() => {
    const current = armed
    disarmMacro()
    stopYdotoold()
    if (current) send(current.target, { kind: 'expired', label: current.label })
  }, ARM_TIMEOUT_MS)
  armed = { values, stems, label, timer, target }
  return { accelerator: MACRO_ACCELERATOR, expiresAt: Date.now() + ARM_TIMEOUT_MS, count: values.length }
}

function typingErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  const text = String((error as { stderr?: string }).stderr || (error as Error).message || error)
  if ((error as { code?: string }).code === 'ENOENT') {
    return process.env['XDG_SESSION_TYPE'] === 'wayland'
      ? 'Typing failed: ydotool is not installed.'
      : 'Typing failed: xdotool is not installed.'
  }
  if (/-1743|not authori[sz]ed to send apple events/i.test(text)) {
    return 'Typing failed: allow CBE Gradebook to control System Events in System Settings → Privacy & Security → Automation.'
  }
  if (/not allowed|1002|-1719|-25211/.test(text)) {
    return 'Typing failed: allow CBE Gradebook in System Settings → Privacy & Security → Accessibility.'
  }
  return `Typing failed: ${text.trim().split('\n')[0]}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Key = 'Enter' | 'Up' | 'Down' | 'Left' | 'Right'
type Step = { text: string } | { key: Key }

const COLLECTED_TEXT = 'co'
const LATE_TEXT = 'la'
const MISSING_TEXT = 'MI'
const LATE_VALUE = /^(.+)L$/

/** The keystrokes for one grade cell, leaving the cursor in that cell with its edit not yet committed. */
function cellSteps(value: string, lastRow: boolean): Step[] {
  const late = LATE_VALUE.exec(value)
  const [grade, marker] = late ? [late[1]!, LATE_TEXT] : value === 'MI' ? ['1', MISSING_TEXT] : [value, null]
  if (marker === null) return [{ text: grade }]
  return lastRow
    ? [{ text: grade }, { key: 'Up' }, { key: 'Down' }, { text: marker }]
    : [{ text: grade }, { key: 'Enter' }, { key: 'Up' }, { text: marker }]
}

/** Row by row: the collected marker, then the grade once per stem, then back to the first column of the next row. */
function buildSteps(values: string[], stems: number): Step[] {
  const steps: Step[] = []
  values.forEach((value, row) => {
    const lastRow = row === values.length - 1
    if (value !== 'MI') steps.push({ text: COLLECTED_TEXT })
    for (let i = 0; i < stems; i++) {
      steps.push({ key: 'Right' }, ...cellSteps(value, lastRow))
    }
    if (!lastRow) {
      steps.push({ key: 'Down' })
      for (let i = 0; i < stems; i++) steps.push({ key: 'Left' })
    }
  })
  return steps
}

async function typeSheet(steps: Step[]): Promise<void> {
  if (process.platform === 'darwin') return typeMac(steps)
  if (process.platform === 'linux') {
    return usesYdotool() ? typeYdotool(steps) : typeXdotool(steps)
  }
  throw new AppError('Typing into other apps is only supported on macOS and Linux.')
}

/**
 * One JXA process does the whole run. It first waits (up to 3 s) for the hotkey's modifier keys to be released,
 * otherwise "4" would arrive as Cmd+Option+Shift+4.
 */
const MAC_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  const delay_ = Number(argv[0]) / 1000;
  const steps = argv.slice(1);
  const mods = 0x1E0000; // Shift | Control | Option | Command
  for (let i = 0; i < 150 && ($.NSEvent.modifierFlags & mods); i++) delay(0.02);
  delay(0.05);
  const se = Application('System Events');
  steps.forEach((step) => {
    if (step[0] === 't') se.keystroke(step.slice(1));
    else se.keyCode(Number(step.slice(1)));
    delay(delay_);
  });
}`

const MAC_KEYCODES: Record<Key, number> = { Enter: 36, Left: 123, Right: 124, Down: 125, Up: 126 }

async function typeMac(steps: Step[]): Promise<void> {
  const args = steps.map((step) => ('text' in step ? `t${step.text}` : `k${MAC_KEYCODES[step.key]}`))
  await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, String(ENTRY_DELAY_MS), ...args], { timeout: 600_000 })
}

/** X11: --clearmodifiers temporarily lifts the still-held hotkey modifiers. */
async function typeXdotool(steps: Step[]): Promise<void> {
  for (const step of steps) {
    if ('text' in step) await run('xdotool', ['type', '--clearmodifiers', '--delay', '12', '--', step.text])
    else await run('xdotool', ['key', '--clearmodifiers', step.key === 'Enter' ? 'Return' : step.key])
    await sleep(ENTRY_DELAY_MS)
  }
}

/**
 * Wayland has no API for synthetic input into other apps, so we use ydotool, which types through a virtual keyboard
 * (/dev/uinput). Rather than relying on a system ydotoold service, we run our own private daemon while an assignment is
 * armed. That works without joining the `input` group because logind grants the logged-in user an ACL on
 * /dev/uinput.
 */
const usesYdotool = (): boolean => process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland'
const YDOTOOL_SOCKET = join(process.env['XDG_RUNTIME_DIR'] || tmpdir(), 'cbe-gradebook-ydotool.sock')
let daemon: { child: ChildProcess; error: string | null } | null = null

/** Started at arm time so the virtual keyboard is already known to the compositor when the hotkey is pressed. */
function startYdotoold(): void {
  if (daemon && daemon.child.exitCode === null && !daemon.error) return
  stopYdotoold()
  rmSync(YDOTOOL_SOCKET, { force: true })
  const child = spawn('ydotoold', ['--socket-path', YDOTOOL_SOCKET, '--socket-perm', '0600', '--mouse-off'], {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  const state: { child: ChildProcess; error: string | null } = { child, error: null }
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  child.on('error', (error: NodeJS.ErrnoException) => {
    state.error = error.code === 'ENOENT' ? 'Typing failed: ydotool is not installed.' : `Typing failed: could not start ydotoold (${error.message}).`
  })
  child.on('exit', (code, signal) => {
    if (signal || state.error) return
    const reason = stderr.trim().split('\n').pop() || `exit code ${code}`
    state.error = /uinput/i.test(stderr)
      ? `Typing failed: no access to /dev/uinput (${reason}).`
      : `Typing failed: ydotoold stopped (${reason}).`
  })
  daemon = state
}

function stopYdotoold(): void {
  if (!daemon) return
  if (daemon.child.exitCode === null) daemon.child.kill()
  daemon = null
  rmSync(YDOTOOL_SOCKET, { force: true })
}

const YDOTOOL_KEYCODES: Record<Key, number> = { Enter: 28, Up: 103, Left: 105, Right: 106, Down: 108 } // Linux input keycodes

async function typeYdotool(steps: Step[]): Promise<void> {
  // Held modifiers can't be detected or cleared on Wayland, so give the user a moment to let go of the hotkey.
  await sleep(600)
  for (let i = 0; i < 20 && daemon && !daemon.error && !existsSync(YDOTOOL_SOCKET); i++) await sleep(100)
  if (!daemon) throw new AppError('Typing failed: ydotoold is not running.')
  if (daemon.error) throw new AppError(daemon.error)
  if (!existsSync(YDOTOOL_SOCKET)) throw new AppError('Typing failed: ydotoold did not start in time.')
  const options = { env: { ...process.env, YDOTOOL_SOCKET } }
  for (const step of steps) {
    if ('text' in step) await run('ydotool', ['type', '--key-delay', '12', '--', step.text], options)
    else {
      const code = YDOTOOL_KEYCODES[step.key]
      await run('ydotool', ['key', `${code}:1`, `${code}:0`], options)
    }
    await sleep(ENTRY_DELAY_MS)
  }
}
