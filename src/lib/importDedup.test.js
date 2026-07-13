// src/lib/importDedup.test.js
import { describe, it, expect } from 'vitest'
import { normalizeName, normalizeEmail, normalizePhone, rowKey, dedupWithinFile } from './importDedup'

describe('normalizePhone (mirrors public.normalize_phone in migration_018)', () => {
  it('treats +972-52-1234567 and 052-1234567 as the same phone', () => {
    expect(normalizePhone('+972-52-1234567')).toBe(normalizePhone('052-1234567'))
  })

  it('normalizes to the canonical Israeli form (972-prefix and leading zeros stripped)', () => {
    expect(normalizePhone('+972-52-1234567')).toBe('521234567')
    expect(normalizePhone('052-1234567')).toBe('521234567')
  })

  // Regression: previously compared on "last 9 digits", which equates +972
  // mobiles with local form (12->9 vs 10->9 digits) but fails for 9-digit
  // Israeli landlines: '03-5551234' -> '035551234' (9 digits, kept as-is)
  // vs '+972-3-5551234' -> '97235551234' -> last 9 = '235551234' (different!).
  // Found via live SQL smoke on dev. Fixed by canonicalizing (strip '972'
  // prefix, then strip ALL leading zeros) instead of taking the last 9 digits.
  it('treats a 9-digit landline and its +972 form as the same phone', () => {
    expect(normalizePhone('03-5551234')).toBe(normalizePhone('+972-3-5551234'))
    expect(normalizePhone('03-5551234')).toBe('35551234')
    expect(normalizePhone('+972-3-5551234')).toBe('35551234')
  })

  it('returns null for a phone shorter than 7 digits', () => {
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('123456')).toBeNull()
  })

  it('accepts a phone at exactly the 7-digit minimum', () => {
    expect(normalizePhone('1234567')).toBe('1234567')
  })

  it('returns null for empty/missing phone', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })
})

describe('normalizeName', () => {
  it('lower/trims and collapses internal whitespace to a single space', () => {
    expect(normalizeName('  יוסי   כהן ')).toBe('יוסי כהן')
    expect(normalizeName('  יוסי   כהן ')).toBe(normalizeName('יוסי כהן'))
  })

  it('is case-insensitive for latin names', () => {
    expect(normalizeName('John   Doe')).toBe(normalizeName('john doe'))
  })

  it('handles null/undefined gracefully', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Israel@Example.COM ')).toBe('israel@example.com')
  })

  it('returns null for empty/missing email', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

describe('rowKey', () => {
  it('produces the same key for rows that normalize identically', () => {
    const a = { name: '  יוסי   כהן ', email: 'Yossi@Example.com', phone: '052-1234567' }
    const b = { name: 'יוסי כהן', email: 'yossi@example.com', phone: '+972-52-1234567' }
    expect(rowKey(a)).toBe(rowKey(b))
  })

  it('produces a different key for a different name', () => {
    const a = { name: 'יוסי כהן', email: 'a@example.com', phone: '' }
    const b = { name: 'דנה לוי', email: 'a@example.com', phone: '' }
    expect(rowKey(a)).not.toBe(rowKey(b))
  })
})

describe('dedupWithinFile', () => {
  it('keeps the first occurrence and counts a same-name+same-email row as a dupe', () => {
    const rows = [
      { name: 'יוסי כהן', email: 'yossi@example.com', phone: '' },
      { name: 'יוסי כהן', email: 'YOSSI@example.com', phone: '050-0000000' },
    ]
    const { unique, intraFileDupes } = dedupWithinFile(rows)
    expect(unique).toHaveLength(1)
    expect(unique[0]).toMatchObject({ name: 'יוסי כהן', email: 'yossi@example.com', i: 0 })
    expect(intraFileDupes).toBe(1)
  })

  it('keeps the first occurrence and counts a same-name+same-phone row as a dupe (different phone formats)', () => {
    const rows = [
      { name: 'דנה לוי', email: '', phone: '+972-52-1234567' },
      { name: 'דנה לוי', email: '', phone: '052-1234567' },
    ]
    const { unique, intraFileDupes } = dedupWithinFile(rows)
    expect(unique).toHaveLength(1)
    expect(intraFileDupes).toBe(1)
  })

  it('does NOT dedup the same name with a different email AND a different phone', () => {
    const rows = [
      { name: 'יוסי כהן', email: 'yossi1@example.com', phone: '050-1111111' },
      { name: 'יוסי כהן', email: 'yossi2@example.com', phone: '050-2222222' },
    ]
    const { unique, intraFileDupes } = dedupWithinFile(rows)
    expect(unique).toHaveLength(2)
    expect(intraFileDupes).toBe(0)
  })

  it('does not treat two rows with empty phone/email as matching on that field alone', () => {
    const rows = [
      { name: 'יוסי כהן', email: '', phone: '' },
      { name: 'יוסי כהן', email: '', phone: '' },
    ]
    const { unique, intraFileDupes } = dedupWithinFile(rows)
    expect(unique).toHaveLength(2)
    expect(intraFileDupes).toBe(0)
  })

  it('does not treat two short (<7 digit) phones as matching', () => {
    const rows = [
      { name: 'יוסי כהן', email: '', phone: '123' },
      { name: 'יוסי כהן', email: '', phone: '123' },
    ]
    const { unique, intraFileDupes } = dedupWithinFile(rows)
    expect(unique).toHaveLength(2)
    expect(intraFileDupes).toBe(0)
  })

  it('preserves original row fields and assigns the original 0-based index to kept rows', () => {
    const rows = [
      { name: 'א', email: 'a@example.com', phone: '' },
      { name: 'ב', email: 'b@example.com', phone: '' },
      { name: 'א', email: 'a@example.com', phone: '' }, // dupe of row 0
    ]
    const { unique, skipped } = dedupWithinFile(rows)
    expect(unique.map((r) => r.i)).toEqual([0, 1])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ name: 'א', i: 2 })
  })

  it('returns an empty skipped list and zero dupes for a file with no internal duplicates', () => {
    const rows = [
      { name: 'א', email: 'a@example.com', phone: '' },
      { name: 'ב', email: 'b@example.com', phone: '' },
    ]
    const { unique, intraFileDupes, skipped } = dedupWithinFile(rows)
    expect(unique).toHaveLength(2)
    expect(intraFileDupes).toBe(0)
    expect(skipped).toEqual([])
  })
})
