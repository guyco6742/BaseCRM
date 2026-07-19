import { describe, it, expect } from 'vitest'
import { normalizeIsraeliPhone, buildCreateProcessForm, mapProcessInfo, growBaseUrl } from './grow.ts'

const creds = { user_id: 'u-123', page_code: 'pc-456', sandbox: true }
const params = {
  amount: 150.5, description: 'חוג ג׳ודו — יולי', clientName: 'ישראל ישראלי',
  clientPhone: '050-123-4567', clientEmail: 'a@b.co', maxInstallments: 3,
  successUrl: 'https://app.example/pay/thanks', cancelUrl: 'https://app.example/pay/thanks?failed=1',
  notifyUrl: 'https://x.supabase.co/functions/v1/payment-webhook?provider=grow&s=sec',
  paymentId: 'pay-1',
}

describe('normalizeIsraeliPhone', () => {
  it('normalizes local and international formats to 05XXXXXXXX', () => {
    expect(normalizeIsraeliPhone('050-123-4567')).toBe('0501234567')
    expect(normalizeIsraeliPhone('+972501234567')).toBe('0501234567')
    expect(normalizeIsraeliPhone('972501234567')).toBe('0501234567')
  })
  it('rejects missing/landline/short numbers', () => {
    expect(normalizeIsraeliPhone(null)).toBeNull()
    expect(normalizeIsraeliPhone('')).toBeNull()
    expect(normalizeIsraeliPhone('031234567')).toBeNull()   // לא סלולרי
    expect(normalizeIsraeliPhone('05012')).toBeNull()
  })
})

describe('buildCreateProcessForm', () => {
  const form = buildCreateProcessForm(creds, params)
  it('includes required Grow fields', () => {
    expect(form.pageCode).toBe('pc-456')
    expect(form.userId).toBe('u-123')
    expect(form.sum).toBe('150.5')
    expect(form.description).toBe('חוג ג׳ודו — יולי')
    expect(form.successUrl).toBe(params.successUrl)
    expect(form.cancelUrl).toBe(params.cancelUrl)
    expect(form.notifyUrl).toBe(params.notifyUrl)
    expect(form['pageField[fullName]']).toBe('ישראל ישראלי')
    expect(form['pageField[phone]']).toBe('0501234567')
    expect(form['pageField[email]']).toBe('a@b.co')
    expect(form.cField1).toBe('pay-1')
    expect(form.chargeType).toBe('1')
  })
  it('sets installments only when maxInstallments > 1', () => {
    expect(form.maxPaymentNum).toBe('3')
    const single = buildCreateProcessForm(creds, { ...params, maxInstallments: 1 })
    expect(single.maxPaymentNum).toBeUndefined()
  })
  it('omits email when absent', () => {
    const noMail = buildCreateProcessForm(creds, { ...params, clientEmail: undefined })
    expect(noMail['pageField[email]']).toBeUndefined()
  })
  it('throws client_phone_required for a missing phone', () => {
    expect(() => buildCreateProcessForm(creds, { ...params, clientPhone: null })).toThrow('client_phone_required')
  })
})

describe('mapProcessInfo', () => {
  it('paid when a transactionCode exists', () => {
    expect(mapProcessInfo({ transactionCode: 'TC1', sum: 150.5 })).toEqual({ status: 'paid', transactionCode: 'TC1' })
  })
  it('pending otherwise', () => {
    expect(mapProcessInfo({})).toEqual({ status: 'pending', transactionCode: undefined })
    expect(mapProcessInfo(null)).toEqual({ status: 'pending', transactionCode: undefined })
  })
})

describe('growBaseUrl', () => {
  it('uses sandbox when flagged', () => {
    expect(growBaseUrl(creds)).toBe('https://sandbox.meshulam.co.il/api/light/server/1.0')
  })
})
