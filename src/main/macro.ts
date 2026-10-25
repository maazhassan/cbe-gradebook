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
 * "Type a column into another app": the renderer arms a list of values, the user switches to a browser and presses
 * the hotkey, and we type each value followed by Enter (no Enter after the last). The hotkey is registered only
 * while armed, and is released when it fires, when the timeout passes, or when the user cancels.
 */

export const MACRO_ACCELERATOR = 'CommandOrControl+Alt+Shift+G'
const ARM_TIMEOUT_MS = 60_000
/** Pause between entries so the web page can move focus to the next field after Enter. */
const ENTRY_DELAY_MS = 120
const run = promisify(execFile)

let armed: { values: string[]; label: string; timer: NodeJS.Timeout; target: WebContents } | null = null
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

function send(target: WebContents, event: MacroEvent): void {
  if (!target.isDestroyed()) target.send('macro:event', event)
}

/**
 * On Linux the hotkey stays registered once bound: Chromium's Wayland portal backend binds the first registration
 * but never fires again after an unregister/register cycle. The handler ignores presses unless a column is armed,
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
  typeValues(current.values)
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

export function armMacro(values: string[], label: string, target: WebContents): MacroArmed {
  if (typing) throw new AppError('Still typing the previous column. Wait for it to finish.')
  if (values.length === 0) throw new AppError('There are no students in this column.')
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
  armed = { values, label, timer, target }
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

async function typeValues(values: string[]): Promise<void> {
  if (process.platform === 'darwin') return typeMac(values)
  if (process.platform === 'linux') {
    return usesYdotool() ? typeYdotool(values) : typeXdotool(values)
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
  const values = argv.slice(1);
  const mods = 0x1E0000; // Shift | Control | Option | Command
  for (let i = 0; i < 150 && ($.NSEvent.modifierFlags & mods); i++) delay(0.02);
  delay(0.05);
  const se = Application('System Events');
  values.forEach((v, i) => {
    se.keystroke(v);
    if (i < values.length - 1) { se.keyCode(36); delay(delay_); }
  });
}`

async function typeMac(values: string[]): Promise<void> {
  await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, String(ENTRY_DELAY_MS), ...values], { timeout: 120_000 })
}

/** X11: --clearmodifiers temporarily lifts the still-held hotkey modifiers. */
async function typeXdotool(values: string[]): Promise<void> {
  for (const [i, v] of values.entries()) {
    await run('xdotool', ['type', '--clearmodifiers', '--delay', '12', '--', v])
    if (i < values.length - 1) {
      await run('xdotool', ['key', '--clearmodifiers', 'Return'])
      await sleep(ENTRY_DELAY_MS)
    }
  }
}

/**
 * Wayland has no API for synthetic input into other apps, so we use ydotool, which types through a virtual keyboard
 * (/dev/uinput). Rather than relying on a system ydotoold service, we run our own private daemon while a column is
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

async function typeYdotool(values: string[]): Promise<void> {
  // Held modifiers can't be detected or cleared on Wayland, so give the user a moment to let go of the hotkey.
  await sleep(600)
  for (let i = 0; i < 20 && daemon && !daemon.error && !existsSync(YDOTOOL_SOCKET); i++) await sleep(100)
  if (!daemon) throw new AppError('Typing failed: ydotoold is not running.')
  if (daemon.error) throw new AppError(daemon.error)
  if (!existsSync(YDOTOOL_SOCKET)) throw new AppError('Typing failed: ydotoold did not start in time.')
  const options = { env: { ...process.env, YDOTOOL_SOCKET } }
  for (const [i, v] of values.entries()) {
    await run('ydotool', ['type', '--key-delay', '12', '--', v], options)
    if (i < values.length - 1) {
      await run('ydotool', ['key', '28:1', '28:0'], options)
      await sleep(ENTRY_DELAY_MS)
    }
  }
}
