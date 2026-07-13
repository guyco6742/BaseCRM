// src/lib/csv.test.js
import { describe, it, expect } from 'vitest'
import { escapeCSVField, exportRowsToCSV, buildClientTemplate } from './csv'

describe('escapeCSVField — CSV formula-injection guard (F4)', () => {
  it('prefixes a leading apostrophe for =', () => {
    expect(escapeCSVField('=SUM(A1)')).toBe("'=SUM(A1)")
  })

  it('prefixes a leading apostrophe for +', () => {
    expect(escapeCSVField('+1')).toBe("'+1")
  })

  it('prefixes a leading apostrophe for -', () => {
    expect(escapeCSVField('-1')).toBe("'-1")
  })

  it('prefixes a leading apostrophe for @', () => {
    expect(escapeCSVField('@cmd')).toBe("'@cmd")
  })

  it('prefixes a leading apostrophe for a tab-leading value', () => {
    expect(escapeCSVField('\tevil')).toBe("'\tevil")
  })

  it('prefixes a leading apostrophe for a CR-leading value', () => {
    expect(escapeCSVField('\revil')).toBe("'\revil")
  })

  it('does not touch benign Hebrew text', () => {
    expect(escapeCSVField('משפחת כהן')).toBe('משפחת כהן')
  })

  it('leaves empty/null/undefined fields as empty strings', () => {
    expect(escapeCSVField('')).toBe('')
    expect(escapeCSVField(null)).toBe('')
    expect(escapeCSVField(undefined)).toBe('')
  })

  it('detects a formula-leading value based on the trimmed form but preserves original leading whitespace before guarding', () => {
    // leading whitespace before the formula char should still be detected as dangerous
    // (Excel/Sheets tolerate leading whitespace before a formula trigger in some cases),
    // and the original content (including the whitespace) must be preserved after the apostrophe.
    expect(escapeCSVField('  =1+1')).toBe("'  =1+1")
  })

  it('composes with comma/quote escaping — apostrophe ends up inside the quotes', () => {
    expect(escapeCSVField('=1,2')).toBe('"\'=1,2"')
  })

  it('composes with quote-doubling when the field also contains a quote', () => {
    expect(escapeCSVField('=1,"2"')).toBe('"\'=1,""2"""')
  })

  it('still quotes benign comma-containing fields without adding an apostrophe', () => {
    expect(escapeCSVField('כהן, משפחה')).toBe('"כהן, משפחה"')
  })
})

describe('exportRowsToCSV — formula-injection guard applied to real export path', () => {
  it('guards a formula-leading cell inside an exported row', () => {
    const csv = exportRowsToCSV(['שם', 'הערות'], [['ישראל ישראלי', '=CMD()']])
    expect(csv).toContain("'=CMD()")
    expect(csv).not.toContain(',=CMD()')
  })

  it('keeps the BOM and CRLF joining behavior', () => {
    const csv = exportRowsToCSV(['a', 'b'], [['1', '2']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('\r\n')
  })
})

describe('buildClientTemplate — round-trip guard on the example row', () => {
  it('does not itself contain an unguarded formula-leading example (sanity: current example is benign)', () => {
    const csv = buildClientTemplate([])
    // The template's own baked-in example row is benign text, so it should NOT
    // be prefixed with an apostrophe.
    expect(csv).toContain('ישראל ישראלי')
    expect(csv).not.toContain("'ישראל ישראלי")
  })

  it('guards a custom field name that is formula-leading', () => {
    const csv = buildClientTemplate([{ id: 'f1', name: '=HYPERLINK("http://evil")' }])
    // quoted because it contains a quote char; apostrophe guard sits right after the opening quote
    expect(csv).toContain('"\'=HYPERLINK(')
  })
})
