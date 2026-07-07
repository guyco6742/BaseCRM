// src/lib/payments.test.js
import { describe, it, expect } from 'vitest'
import {
  PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount,
  sumByStatus, filterPayments, paymentToCSVRow, PAYMENT_CSV_HEADERS,
} from './payments'

const p = (over = {}) => ({
  id: 'x', amount: 100, currency: 'ILS', status: 'pending', method: 'cash',
  description: 'חוג', client_id: 'c1', paid_at: null, due_date: null,
  created_at: '2026-07-01T10:00:00Z', is_archived: false, ...over,
})

describe('payments lib', () => {
  it('has Hebrew labels for every status and method', () => {
    for (const s of ['pending', 'paid', 'failed', 'canceled', 'refunded']) {
      expect(PAYMENT_STATUSES[s].label).toBeTruthy()
      expect(PAYMENT_STATUSES[s].chipClass).toBeTruthy()
    }
    for (const m of ['credit_card', 'bit', 'cash', 'bank_transfer', 'check', 'other']) {
      expect(PAYMENT_METHODS[m].label).toBeTruthy()
    }
  })

  it('formats ILS amounts', () => {
    // לא משווים למחרוזת מלאה — Intl מוסיף תווי כיווניות שתלויים בסביבת הריצה
    expect(formatAmount(1200.5)).toMatch(/1,200\.50/)
    expect(formatAmount(1200.5)).toMatch(/₪/)
  })

  it('sums pending and paid, skipping archived', () => {
    const rows = [p(), p({ status: 'paid', amount: 50 }), p({ status: 'paid', amount: 25, is_archived: true }), p({ status: 'failed' })]
    expect(sumByStatus(rows)).toEqual({ pending: 100, paid: 50 })
  })

  it('filters by status, client and date range', () => {
    const rows = [
      p({ id: 'a', status: 'paid', client_id: 'c1', created_at: '2026-01-05T00:00:00Z' }),
      p({ id: 'b', status: 'paid', client_id: 'c2', created_at: '2026-02-05T00:00:00Z' }),
      p({ id: 'c', status: 'pending', client_id: 'c1', created_at: '2026-03-05T00:00:00Z' }),
    ]
    expect(filterPayments(rows, { status: 'paid' }).map(r => r.id)).toEqual(['a', 'b'])
    expect(filterPayments(rows, { clientId: 'c1' }).map(r => r.id)).toEqual(['a', 'c'])
    expect(filterPayments(rows, { from: '2026-02-01', to: '2026-02-28' }).map(r => r.id)).toEqual(['b'])
    expect(filterPayments(rows, {}).length).toBe(3)
  })

  it('builds a CSV row matching the headers length', () => {
    const row = paymentToCSVRow(p({ status: 'paid', paid_at: '2026-07-02T08:00:00Z' }), 'משפחת כהן')
    expect(row.length).toBe(PAYMENT_CSV_HEADERS.length)
    expect(row).toContain('משפחת כהן')
    expect(row.join(',')).toMatch(/שולם/)
  })
})
