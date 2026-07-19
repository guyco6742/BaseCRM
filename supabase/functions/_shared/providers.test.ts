import { describe, it, expect } from 'vitest'
import { pickAccount } from './providers.ts'

const cc = { id: '1', provider: 'cardcom' }
const gr = { id: '2', provider: 'grow' }

describe('pickAccount', () => {
  it('errors when no active accounts', () => {
    expect(pickAccount([], null)).toEqual({ error: 'no_active_provider' })
  })
  it('uses the single active account when none requested', () => {
    expect(pickAccount([gr], null)).toEqual({ account: gr })
  })
  it('requires explicit choice when several are active', () => {
    expect(pickAccount([cc, gr], null)).toEqual({ error: 'provider_required' })
  })
  it('honors the requested provider', () => {
    expect(pickAccount([cc, gr], 'grow')).toEqual({ account: gr })
  })
  it('errors when requested provider is not connected', () => {
    expect(pickAccount([cc], 'grow')).toEqual({ error: 'no_active_provider' })
  })
})
