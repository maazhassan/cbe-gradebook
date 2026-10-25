import { ScoreIndex, formatAverage, formatDueDate, formatGrade, formatNumber, stemAveragesForStudent, toPowerSchoolGrade } from './grading'
import { toCsv } from './csv'
import type { CsvCell } from './csv'
import type { CourseGradebook, GradebookAssignment, RosterStudent } from './types'

const studentName = (s: RosterStudent): string => `${s.lastName}, ${s.firstName}`

function assignmentHeader(a: GradebookAssignment, gb: CourseGradebook): string {
  const stems = a.stemIds.map((id) => gb.stems.find((s) => s.id === id)?.name).filter(Boolean)
  const stemText = stems.length ? `; stems: ${stems.join('/')}` : ''
  return `${a.name} (max ${formatNumber(a.maxPoints)}; weight ${a.weight}; due ${formatDueDate(a.dueDate)}${stemText})`
}

export function rawScoresCsv(gb: CourseGradebook): string {
  const idx = new ScoreIndex(gb.scores)
  const rows: CsvCell[][] = [['Student', ...gb.assignments.map((a) => assignmentHeader(a, gb))]]
  for (const s of gb.students) {
    rows.push([studentName(s), ...gb.assignments.map((a) => idx.get(s.id, a.id))])
  }
  return toCsv(rows)
}

export function powerSchoolCsv(gb: CourseGradebook): string {
  const idx = new ScoreIndex(gb.scores)
  const rows: CsvCell[][] = [['Student', ...gb.assignments.map((a) => assignmentHeader(a, gb))]]
  for (const s of gb.students) {
    rows.push([studentName(s), ...gb.assignments.map((a) => formatGrade(toPowerSchoolGrade(idx.get(s.id, a.id), a.maxPoints)))])
  }
  return toCsv(rows)
}

export function stemAveragesCsv(gb: CourseGradebook): string {
  const idx = new ScoreIndex(gb.scores)
  const stemIds = gb.stems.map((s) => s.id)
  // Each stem gets two columns: the 2-decimal average and the whole-number rounding.
  const rows: CsvCell[][] = [['Student', ...gb.stems.flatMap((s) => [s.name, `${s.name} (rounded)`])]]
  for (const s of gb.students) {
    const scoreOf = (aid: number) => idx.get(s.id, aid)
    const exact = stemAveragesForStudent(gb.assignments, stemIds, scoreOf)
    const whole = stemAveragesForStudent(gb.assignments, stemIds, scoreOf, 0)
    rows.push([studentName(s), ...stemIds.flatMap((id) => [formatAverage(exact.get(id) ?? null), formatAverage(whole.get(id) ?? null, 0)])])
  }
  return toCsv(rows)
}
