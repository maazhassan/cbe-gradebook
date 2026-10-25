import { describe, expect, it } from 'vitest'
import {
  ScoreIndex, formatAverage, parseScoreInput, stemAveragesForStudent, toPowerSchoolGrade,
  validateMaxPoints, validateRawScore, validateWeight, weightedAverage
} from '../src/shared/grading'

describe('PowerSchool grade conversion', () => {
  it('blank -> blank', () => {
    expect(toPowerSchoolGrade(null, 10)).toBeNull()
    expect(toPowerSchoolGrade(undefined, 10)).toBeNull()
  })
  it('zero -> 1', () => expect(toPowerSchoolGrade(0, 10)).toBe(1))
  it('threshold boundaries', () => {
    expect(toPowerSchoolGrade(49.99, 100)).toBe(1)
    expect(toPowerSchoolGrade(50, 100)).toBe(2)
    expect(toPowerSchoolGrade(69.99, 100)).toBe(2)
    expect(toPowerSchoolGrade(70, 100)).toBe(3)
    expect(toPowerSchoolGrade(89.99, 100)).toBe(3)
    expect(toPowerSchoolGrade(90, 100)).toBe(4)
  })
  it('maximum -> 4', () => expect(toPowerSchoolGrade(7.5, 7.5)).toBe(4))
  it('exact percentages survive floating point noise', () => {
    expect(toPowerSchoolGrade(0.7, 1)).toBe(3)
    expect(toPowerSchoolGrade(2.7, 3)).toBe(4)
    expect(toPowerSchoolGrade(2.1, 3)).toBe(3)
    expect(toPowerSchoolGrade(1.5, 3)).toBe(2)
    expect(toPowerSchoolGrade(63, 70)).toBe(4)
  })
  it('does not round the percentage first', () => {
    // 89.996% would round to 90.00 at two decimals but is still a 3.
    expect(toPowerSchoolGrade(8999.6, 10000)).toBe(3)
    expect(toPowerSchoolGrade(49.996, 100)).toBe(1)
  })
})

describe('weighted stem average', () => {
  const item = (score: number | null, weight = 1, maxPoints = 10) => ({ score, maxPoints, weight })
  it('single assignment yields its grade regardless of weight', () => {
    expect(weightedAverage([item(8, 1)])).toBe(3)
    expect(weightedAverage([item(8, 5)])).toBe(3)
  })
  it('weights 1 and 2', () => {
    // grades 4 (w1) and 1 (w2) -> (4 + 2) / 3 = 2
    expect(weightedAverage([item(10, 1), item(2, 2)])).toBe(2)
    // grades 4 (w2) and 1 (w1) -> 9 / 3 = 3
    expect(weightedAverage([item(10, 2), item(2, 1)])).toBe(3)
  })
  it('blank scores are excluded from numerator and denominator', () => {
    expect(weightedAverage([item(10, 1), item(null, 3)])).toBe(4)
  })
  it('nothing graded -> null (blank)', () => {
    expect(weightedAverage([])).toBeNull()
    expect(weightedAverage([item(null)])).toBeNull()
    expect(formatAverage(null)).toBe('')
  })
  it('rounds to two decimals and stays within 1..4', () => {
    const avg = weightedAverage([item(10), item(8), item(8)])! // (4+3+3)/3 = 3.333..
    expect(avg).toBe(3.33)
    expect(formatAverage(avg)).toBe('3.33')
    expect(formatAverage(3)).toBe('3.00')
    expect(weightedAverage([item(5, 1), item(5, 1), item(0, 1)])).toBe(1.67) // (2+2+1)/3 = 1.666..
    for (const s of [0, 3, 5, 7, 9, 10]) {
      const v = weightedAverage([item(s, 3), item(10 - s, 7)])!
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(4)
    }
  })
  it('rounds half up exactly', () => {
    // grades 4,3,3,3 weight 1 -> 3.25 ; grades 2,1,1,1,... check x.xx5 cases
    expect(weightedAverage([item(10, 1), item(8, 1), item(8, 1), item(8, 1)])).toBe(3.25)
    // (4*1 + 3*7)/8 = 3.125 -> 3.13
    expect(weightedAverage([item(10, 1), item(8, 7)])).toBe(3.13)
  })
  it('an assignment linked to two stems contributes fully to both', () => {
    const assignments = [
      { id: 1, maxPoints: 10, weight: 2, stemIds: [1, 2] },
      { id: 2, maxPoints: 10, weight: 1, stemIds: [2] }
    ]
    const idx = new ScoreIndex([
      { assignmentId: 1, studentId: 9, rawScore: 10 },
      { assignmentId: 2, studentId: 9, rawScore: 2 }
    ])
    const avgs = stemAveragesForStudent(assignments, [1, 2, 3], (a) => idx.get(9, a))
    expect(avgs.get(1)).toBe(4)
    expect(avgs.get(2)).toBe(3) // (4*2 + 1*1) / 3
    expect(avgs.get(3)).toBeNull()
  })
})

describe('validation', () => {
  it('max points', () => {
    expect(validateMaxPoints(10)).toBeNull()
    expect(validateMaxPoints(2.5)).toBeNull()
    for (const bad of [0, -1, NaN, Infinity, '5']) expect(validateMaxPoints(bad)).not.toBeNull()
  })
  it('weight', () => {
    expect(validateWeight(1)).toBeNull()
    expect(validateWeight(3)).toBeNull()
    for (const bad of [0, -2, 1.5, NaN]) expect(validateWeight(bad)).not.toBeNull()
  })
  it('raw scores: max accepted, blank allowed, bad rejected', () => {
    expect(validateRawScore(10, 10)).toBeNull()
    expect(validateRawScore(0, 10)).toBeNull()
    expect(validateRawScore(null, 10)).toBeNull()
    for (const bad of [-1, 10.01, NaN, Infinity]) expect(validateRawScore(bad, 10)).not.toBeNull()
  })
  it('cell parsing', () => {
    expect(parseScoreInput('', 10)).toEqual({ ok: true, value: null })
    expect(parseScoreInput('  ', 10)).toEqual({ ok: true, value: null })
    expect(parseScoreInput('0', 10)).toEqual({ ok: true, value: 0 })
    expect(parseScoreInput('7.5', 10)).toEqual({ ok: true, value: 7.5 })
    expect(parseScoreInput('10', 10)).toEqual({ ok: true, value: 10 })
    for (const bad of ['-1', 'abc', 'Infinity', '1e3', '11', '1,5', 'NaN']) expect(parseScoreInput(bad, 10).ok).toBe(false)
  })
})
