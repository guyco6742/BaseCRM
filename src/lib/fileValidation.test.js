// src/lib/fileValidation.test.js
import { describe, it, expect } from 'vitest'
import { validateFile, MAX_FILE_MB, MAX_FILE_BYTES, ALLOWED_EXTENSIONS } from './fileValidation'

function makeFile(name, sizeBytes, type = 'application/octet-stream') {
  const file = new File([new Uint8Array(Math.max(sizeBytes, 0))], name, { type })
  // jsdom computes size from content; override defensively in case of truncation for huge sizes
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

describe('fileValidation (F2 — client-side upload allowlist + size cap)', () => {
  it('exposes a 10MB cap', () => {
    expect(MAX_FILE_MB).toBe(10)
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024)
  })

  it('accepts an allowed pdf within size', () => {
    expect(ALLOWED_EXTENSIONS).toContain('pdf')
    const file = makeFile('invoice.pdf', 1024)
    expect(validateFile(file)).toEqual({ ok: true })
  })

  it('rejects a disallowed .exe extension with reason type', () => {
    const file = makeFile('setup.exe', 1024)
    const result = validateFile(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('type')
    expect(result.message).toBe('סוג הקובץ אינו נתמך (.exe)')
  })

  it('accepts an uppercase extension (.PDF)', () => {
    const file = makeFile('SCAN.PDF', 2048)
    expect(validateFile(file)).toEqual({ ok: true })
  })

  it('rejects a file with no extension', () => {
    const file = makeFile('README', 100)
    const result = validateFile(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('type')
  })

  it('rejects a file over 10MB with reason size', () => {
    const file = makeFile('big.pdf', MAX_FILE_BYTES + 1)
    const result = validateFile(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('size')
    expect(result.message).toBe('הקובץ גדול מדי (מקסימום 10MB)')
  })

  it('accepts a file that is exactly 10MB', () => {
    const file = makeFile('exact.pdf', MAX_FILE_BYTES)
    expect(validateFile(file)).toEqual({ ok: true })
  })

  it('accepts a Hebrew filename with an allowed extension', () => {
    const file = makeFile('חוזה לקוח.docx', 1024)
    expect(validateFile(file)).toEqual({ ok: true })
  })
})
