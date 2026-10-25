// Authoritative grading rules. Pure functions only: no React, no SQL.
// Every screen (gradebook views, student dashboard, CSV export) derives values from here.

export type PowerSchoolGrade = 1 | 2 | 3 | 4

/** Guards float noise such as 0.7 * 100 landing a hair under 70. It is not rounding. */
const EPSILON = 1e-9

export function percentage(rawScore: number, maxPoints: number): number {
  return (rawScore / maxPoints) * 100
}

/** Blank (null/undefined) score -> blank grade. Percentage is never rounded before thresholds. */
export function toPowerSchoolGrade(
  rawScore: number | null | undefined,
  maxPoints: number
): PowerSchoolGrade | null {
  if (rawScore === null || rawScore === undefined) return null
  const pct = percentage(rawScore, maxPoints)
  if (pct >= 90 - EPSILON) return 4
  if (pct >= 70 - EPSILON) return 3
  if (pct >= 50 - EPSILON) return 2
  return 1
}

export interface WeightedItem {
  score: number | null | undefined
  maxPoints: number
  weight: number
}

/**
 * Weighted average of PowerSchool grades, rounded half-up to 2 decimals.
 * Blank scores are excluded from numerator and denominator. Returns null when nothing is graded.
 * Uses integer arithmetic (grades and weights are integers) so rounding is exact.
 */
export function weightedAverage(items: readonly WeightedItem[]): number | null {
  let numerator = 0
  let denominator = 0
  for (const item of items) {
    const grade = toPowerSchoolGrade(item.score, item.maxPoints)
    if (grade === null) continue
    numerator += grade * item.weight
    denominator += item.weight
  }
  if (denominator === 0) return null
  return Math.floor((numerator * 200 + denominator) / (2 * denominator)) / 100
}

export function formatAverage(value: number | null): string {
  return value === null ? '' : value.toFixed(2)
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
  rawScore: number
}

export class ScoreIndex {
  private readonly map = new Map<string, number>()
  constructor(scores: readonly ScoreRecord[]) {
    for (const s of scores) this.map.set(`${s.studentId}:${s.assignmentId}`, s.rawScore)
  }
  get(studentId: number, assignmentId: number): number | null {
    return this.map.get(`${studentId}:${assignmentId}`) ?? null
  }
}

/** Weighted stem averages for one student. Stems with no graded assignment map to null. */
export function stemAveragesForStudent(
  assignments: readonly GradedAssignment[],
  stemIds: readonly number[],
  scoreOf: (assignmentId: number) => number | null
): Map<number, number | null> {
  const result = new Map<number, number | null>()
  for (const stemId of stemIds) {
    const items: WeightedItem[] = assignments
      .filter((a) => a.stemIds.includes(stemId))
      .map((a) => ({ score: scoreOf(a.id), maxPoints: a.maxPoints, weight: a.weight }))
    result.set(stemId, weightedAverage(items))
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

/** `null` is a valid (blank) score. */
export function validateRawScore(value: unknown, maxPoints: number): string | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Score must be a number.'
  if (value < 0) return 'Score cannot be negative.'
  if (value > maxPoints) return `Score cannot be more than ${formatNumber(maxPoints)}.`
  return null
}

const DECIMAL = /^[+]?(\d+(\.\d*)?|\.\d+)$/

export type ScoreParse = { ok: true; value: number | null } | { ok: false; error: string }

/** Parse text typed into a grid cell. Empty text is a blank score, not zero. */
export function parseScoreInput(text: string, maxPoints: number): ScoreParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.startsWith('-')) return { ok: false, error: 'Score cannot be negative.' }
  if (!DECIMAL.test(trimmed)) return { ok: false, error: 'Enter a number (or leave blank).' }
  const value = Number(trimmed)
  const error = validateRawScore(value, maxPoints)
  return error ? { ok: false, error } : { ok: true, value }
}

/** Same string rules for a form field holding a positive decimal (max points). */
export function parsePositiveNumber(text: string): number | null {
  const trimmed = text.trim()
  return DECIMAL.test(trimmed) ? Number(trimmed) : null
}
