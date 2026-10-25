import { ScoreIndex, formatAverage, formatGrade, formatNumber, stemAveragesForStudent, toPowerSchoolGrade } from './grading'
import { toCsv } from './csv'
import type { CsvCell } from './csv'
import type { CourseGradebook, GradebookAssignment, RosterStudent } from './types'

const studentName = (s: RosterStudent): string => `${s.lastName}, ${s.firstName}`

function assignmentHeader(a: GradebookAssignment, gb: CourseGradebook): string {
  const stems = a.stemIds.map((id) => gb.stems.find((s) => s.id === id)?.name).filter(Boolean)
  const stemText = stems.length ? `; stems: ${stems.join('/')}` : ''
  return `${a.name} (max ${formatNumber(a.maxPoints)}; weight ${a.weight}${stemText})`
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
  const rows: CsvCell[][] = [['Student', ...gb.stems.map((s) => s.name)]]
  for (const s of gb.students) {
    const avgs = stemAveragesForStudent(gb.assignments, stemIds, (aid) => idx.get(s.id, aid))
    rows.push([studentName(s), ...stemIds.map((id) => formatAverage(avgs.get(id) ?? null))])
  }
  return toCsv(rows)
}
