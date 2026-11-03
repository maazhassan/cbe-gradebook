// Authoritative grading rules. Pure functions only: no React, no SQL.
// Every screen (gradebook views, student dashboard, CSV export) derives values from here.

export type PowerSchoolGrade = 1 | 2 | 3 | 4

/** Guards float noise such as 0.7 * 100 landing a hair under 70. It is not rounding. */
const EPSILON = 1e-9

export function percentage(rawScore: number, maxPoints: number): number {
  return (rawScore / maxPoints) * 100
}

/** A recorded mark: a number of points, 'M' (missing, counts as 0) or 'E' (exempt, excluded). */
export type Score = number | 'M' | 'E'

export const MISSING = 'M'
export const EXEMPT = 'E'
/** Typed after a number to mark it late: "26L". */
export const LATE_SUFFIX = 'L'

/** Blank (null/undefined) and exempt -> blank grade. Missing is a zero. Percentage is never rounded before thresholds. */
export function toPowerSchoolGrade(
  rawScore: Score | null | undefined,
  maxPoints: number
): PowerSchoolGrade | null {
  if (rawScore === null || rawScore === undefined || rawScore === EXEMPT) return null
  if (rawScore === MISSING) return 1
  const pct = percentage(rawScore, maxPoints)
  if (pct >= 90 - EPSILON) return 4
  if (pct >= 70 - EPSILON) return 3
  if (pct >= 50 - EPSILON) return 2
  return 1
}

export interface WeightedItem {
  score: Score | null | undefined
  maxPoints: number
  weight: number
}

/**
 * Weighted average of PowerSchool grades, rounded half-up to 2 decimals (or to a whole number, from the exact value).
 * Blank and exempt scores are excluded; missing counts as 0 from numerator and denominator. Returns null when nothing is graded.
 * Uses integer arithmetic (grades and weights are integers) so rounding is exact.
 */
export type AverageDecimals = 0 | 2

export function weightedAverage(items: readonly WeightedItem[], decimals: AverageDecimals = 2): number | null {
  let numerator = 0
  let denominator = 0
  for (const item of items) {
    const grade = toPowerSchoolGrade(item.score, item.maxPoints)
    if (grade === null) continue
    numerator += grade * item.weight
    denominator += item.weight
  }
  if (denominator === 0) return null
  const scale = 10 ** decimals
  return Math.floor((numerator * 2 * scale + denominator) / (2 * denominator)) / scale
}

export function formatAverage(value: number | null, decimals: AverageDecimals = 2): string {
  return value === null ? '' : value.toFixed(decimals)
}

export function formatGrade(value: PowerSchoolGrade | null): string {
  return value === null ? '' : String(value)
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

// ---------- derived views over course data ----------

export interface GradedAssignment {
  id: number
  maxPoints: number
  weight: number
  stemIds: readonly number[]
}

export interface ScoreRecord {
  assignmentId: number
  studentId: number
  rawScore: Score
  /** Handed in late. Only ever set together with a numeric score; absent means on time. */
  late?: boolean
  /** ISO date a late assignment was handed in. Only meaningful when `late`. */
  submittedDate?: string | null
}

export class ScoreIndex {
  private readonly map = new Map<string, ScoreRecord>()
  constructor(scores: readonly ScoreRecord[]) {
    for (const s of scores) this.map.set(`${s.studentId}:${s.assignmentId}`, s)
  }
  get(studentId: number, assignmentId: number): Score | null {
    return this.map.get(`${studentId}:${assignmentId}`)?.rawScore ?? null
  }
  isLate(studentId: number, assignmentId: number): boolean {
    return this.map.get(`${studentId}:${assignmentId}`)?.late === true
  }
  submittedDate(studentId: number, assignmentId: number): string | null {
    return this.map.get(`${studentId}:${assignmentId}`)?.submittedDate ?? null
  }
}

/** Weighted stem averages for one student. Stems with no graded assignment map to null. */
export function stemAveragesForStudent(
  assignments: readonly GradedAssignment[],
  stemIds: readonly number[],
  scoreOf: (assignmentId: number) => Score | null,
  decimals: AverageDecimals = 2
): Map<number, number | null> {
  const result = new Map<number, number | null>()
  for (const stemId of stemIds) {
    const items: WeightedItem[] = assignments
      .filter((a) => a.stemIds.includes(stemId))
      .map((a) => ({ score: scoreOf(a.id), maxPoints: a.maxPoints, weight: a.weight }))
    result.set(stemId, weightedAverage(items, decimals))
  }
  return result
}

// ---------- validation (shared by renderer inline validation and main-process services) ----------

export function validateMaxPoints(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Maximum points must be a number.'
  if (value <= 0) return 'Maximum points must be greater than 0.'
  return null
}

export function validateWeight(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Weight must be a whole number.'
  if (value < 1) return 'Weight must be at least 1.'
  return null
}

/** Due dates are ISO calendar dates (YYYY-MM-DD) and must be real dates. */
export function validateDueDate(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return 'Due date is required.'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return 'Due date must be a date.'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  return real && y >= 1900 ? null : 'Due date must be a real date.'
}

/** "2026-10-24" -> "Oct 24, 2026" (no timezone shifting). */
export function formatDueDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Whole calendar days from `dueDate` to `submittedDate` (both YYYY-MM-DD). Negative if handed in early. */
export function daysLate(dueDate: string, submittedDate: string): number {
  const utc = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y!, m! - 1, d!)
  }
  return Math.round((utc(submittedDate) - utc(dueDate)) / 86_400_000)
}

/** "3 days late" / "1 day late"; empty when not actually after the due date. */
export function formatDaysLate(days: number): string {
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} late` : ''
}

/** `null` (blank), 'M' and 'E' are valid scores. */
export function validateRawScore(value: unknown, maxPoints: number): string | null {
  if (value === null || value === MISSING || value === EXEMPT) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Score must be a number.'
  if (value < 0) return 'Score cannot be negative.'
  if (value > maxPoints) return `Score cannot be more than ${formatNumber(maxPoints)}.`
  return null
}

const DECIMAL = /^[+]?(\d+(\.\d*)?|\.\d+)$/

export type ScoreParse = { ok: true; value: Score | null; late: boolean } | { ok: false; error: string }

/**
 * Parse text typed into a grid cell. Empty text is a blank score, not zero. "M"/"E" (any case) are missing/exempt.
 * A trailing "L" marks a late score ("26L"); it needs a numeric score in front of it.
 */
export function parseScoreInput(text: string, maxPoints: number): ScoreParse {
  let trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null, late: false }
  const letter = trimmed.toUpperCase()
  if (letter === MISSING || letter === EXEMPT) return { ok: true, value: letter, late: false }
  const late = letter.endsWith(LATE_SUFFIX)
  if (late) {
    trimmed = trimmed.slice(0, -1).trimEnd()
    if (trimmed === '') return { ok: false, error: 'A late score needs a number, e.g. 26L.' }
  }
  if (trimmed.startsWith('-')) return { ok: false, error: 'Score cannot be negative.' }
  if (!DECIMAL.test(trimmed)) return { ok: false, error: 'Enter a number (add L if late), M (missing), E (exempt), or leave blank.' }
  const value = Number(trimmed)
  const error = validateRawScore(value, maxPoints)
  return error ? { ok: false, error } : { ok: true, value, late }
}

/** Same string rules for a form field holding a positive decimal (max points). */
export function parsePositiveNumber(text: string): number | null {
  const trimmed = text.trim()
  return DECIMAL.test(trimmed) ? Number(trimmed) : null
}

/** Cell/label text for a score: the number (plus "L" when late), or the letter for a missing/exempt mark. */
export function formatScore(value: Score | null, late = false): string {
  if (value === null) return ''
  if (typeof value !== 'number') return value
  return formatNumber(value) + (late ? LATE_SUFFIX : '')
}

/** PowerSchool shows a late grade as "3 (L)". */
export function formatGradeLate(value: PowerSchoolGrade | null, late: boolean): string {
  return late && value !== null ? `${value} (${LATE_SUFFIX})` : formatGrade(value)
}
