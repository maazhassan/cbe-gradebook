// Minimal RFC 4180 CSV reading/writing, plus the roster import format.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"' && field === '') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0]?.trim() === ''))
}

export type CsvCell = string | number | null

/** Text that a spreadsheet could interpret as a formula is prefixed with an apostrophe. */
function guard(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !/^[+-]?\d*\.?\d+$/.test(value) ? `'${value}` : value
}

export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return (
    rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell === null) return ''
            const s = typeof cell === 'number' ? String(cell) : guard(cell)
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          })
          .join(',')
      )
      .join('\r\n') + '\r\n'
  )
}

// ---------- roster import ----------

export interface RosterRow {
  line: number
  firstName: string
  lastName: string
  error: string | null
}

export interface RosterParse {
  rows: RosterRow[]
  fileError: string | null
}

const normHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s-]+/g, '_')

export function parseRosterCsv(text: string): RosterParse {
  const table = parseCsv(text)
  const header = table[0]?.map(normHeader)
  if (!header) return { rows: [], fileError: 'The file is empty.' }
  const first = header.indexOf('first_name')
  const last = header.indexOf('last_name')
  if (first < 0 || last < 0) {
    return { rows: [], fileError: 'The first row must be a header containing first_name and last_name.' }
  }
  const rows: RosterRow[] = table.slice(1).map((cells, i) => {
    const firstName = (cells[first] ?? '').trim()
    const lastName = (cells[last] ?? '').trim()
    let error: string | null = null
    if (!firstName || !lastName) error = 'first_name and last_name are both required.'
    else if (firstName.length > 100 || lastName.length > 100) error = 'Names must be 100 characters or fewer.'
    return { line: i + 2, firstName, lastName, error }
  })
  return { rows, fileError: rows.length === 0 ? 'The file has a header but no student rows.' : null }
}

export const nameKey = (firstName: string, lastName: string): string =>
  `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`
