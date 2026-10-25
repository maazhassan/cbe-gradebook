import { describe, expect, it } from 'vitest'
import { parseCsv, parseRosterCsv, toCsv } from '../src/shared/csv'

describe('csv', () => {
  it('parses quotes, commas, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  })
  it('writes blanks and escapes', () => {
    expect(toCsv([['a', null, 'b,c', 3]])).toBe('a,,"b,c",3\r\n')
  })
  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(toCsv([['=SUM(A1)', '-5', 'plain']])).toBe("'=SUM(A1),-5,plain\r\n")
  })
  it('roster: header required', () => {
    expect(parseRosterCsv('name\nAda').fileError).toBeTruthy()
  })
  it('roster: flags invalid rows, accepts header variants', () => {
    const r = parseRosterCsv('First Name,Last_Name\nAda,Lovelace\n,Smith\n')
    expect(r.fileError).toBeNull()
    expect(r.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', error: null, line: 2 })
    expect(r.rows[1]?.error).toBeTruthy()
  })
})
