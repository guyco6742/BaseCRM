import { describe, it, expect } from 'vitest'
import { isValidEmail, isValidIsraeliPhone } from './validation'

describe('isValidEmail', () => {
  it('accepts empty/blank as valid (optional field)', () => {
    expect(isValidEmail('')).toBe(true)
    expect(isValidEmail('   ')).toBe(true)
    expect(isValidEmail(undefined)).toBe(true)
    expect(isValidEmail(null)).toBe(true)
  })

  it('accepts well-formed emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('john.doe@example.com')).toBe(true)
    expect(isValidEmail('  a@b.co  ')).toBe(true)
    expect(isValidEmail('אבי@חברה.co.il')).toBe(true)
  })

  it('rejects malformed emails', () => {
    expect(isValidEmail('foo')).toBe(false)
    expect(isValidEmail('foo@bar')).toBe(false) // no dot in domain
    expect(isValidEmail('foo@.com')).toBe(false)
    expect(isValidEmail('@bar.com')).toBe(false)
    expect(isValidEmail('foo bar@baz.com')).toBe(false) // internal space
    expect(isValidEmail('foo@bar@baz.com')).toBe(false)
  })
})

describe('isValidIsraeliPhone', () => {
  it('accepts empty/blank as valid (optional field)', () => {
    expect(isValidIsraeliPhone('')).toBe(true)
    expect(isValidIsraeliPhone('   ')).toBe(true)
    expect(isValidIsraeliPhone(undefined)).toBe(true)
    expect(isValidIsraeliPhone(null)).toBe(true)
  })

  it('accepts local mobile numbers (05X-XXXXXXX, 9 digits after zero-strip)', () => {
    expect(isValidIsraeliPhone('052-1234567')).toBe(true)
    expect(isValidIsraeliPhone('0521234567')).toBe(true)
    expect(isValidIsraeliPhone('054 123 4567')).toBe(true)
  })

  it('accepts +972 international mobile form', () => {
    expect(isValidIsraeliPhone('+972-52-1234567')).toBe(true)
    expect(isValidIsraeliPhone('+972521234567')).toBe(true)
  })

  it('accepts local landline numbers (8 digits after zero-strip)', () => {
    expect(isValidIsraeliPhone('03-5551234')).toBe(true)
    expect(isValidIsraeliPhone('035551234')).toBe(true)
  })

  it('accepts +972 international landline form', () => {
    expect(isValidIsraeliPhone('+972-3-5551234')).toBe(true)
  })

  it('rejects too-short numbers', () => {
    expect(isValidIsraeliPhone('123')).toBe(false)
    expect(isValidIsraeliPhone('12345')).toBe(false)
  })

  it('rejects too-long numbers', () => {
    expect(isValidIsraeliPhone('1234567890123')).toBe(false)
  })

  it('rejects non-numeric junk', () => {
    expect(isValidIsraeliPhone('abc-defg')).toBe(false)
  })
})
