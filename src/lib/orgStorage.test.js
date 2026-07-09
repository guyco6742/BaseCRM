// src/lib/orgStorage.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { orgKey, readOrgPref, writeOrgPref } from './orgStorage'

// happy-dom / jsdom is not installed in this project's vitest config, so we stub
// a minimal in-memory localStorage before each test.
function createLocalStorageStub() {
  let store = {}
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value)
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
}

beforeEach(() => {
  globalThis.localStorage = createLocalStorageStub()
})

describe('orgKey', () => {
  it('namespaces a preference name under the given org id', () => {
    expect(orgKey('org-1', 'clientsView')).toBe('basecrm.org-1.clientsView')
  })
})

describe('readOrgPref / writeOrgPref — org-scoped round trip', () => {
  it('writes and reads back a value scoped to one org', () => {
    writeOrgPref('org-1', 'clientsView', 'kanban')
    expect(readOrgPref('org-1', 'clientsView')).toBe('kanban')
  })

  it('two different org ids do not collide', () => {
    writeOrgPref('org-1', 'clientsView', 'kanban')
    writeOrgPref('org-2', 'clientsView', 'list')
    expect(readOrgPref('org-1', 'clientsView')).toBe('kanban')
    expect(readOrgPref('org-2', 'clientsView')).toBe('list')
  })

  it('returns null when nothing is set for the org and there is no legacy key', () => {
    expect(readOrgPref('org-1', 'clientsView')).toBeNull()
  })
})

describe('readOrgPref — one-time legacy migration', () => {
  it('adopts a legacy global value into the current org and removes the legacy key', () => {
    localStorage.setItem('basecrm.clientsView', 'kanban')

    const value = readOrgPref('org-1', 'clientsView', 'basecrm.clientsView')

    expect(value).toBe('kanban')
    expect(localStorage.getItem('basecrm.org-1.clientsView')).toBe('kanban')
    expect(localStorage.getItem('basecrm.clientsView')).toBeNull()
  })

  it('only migrates once — a second read does not re-touch the (already removed) legacy key', () => {
    localStorage.setItem('basecrm.clientsView', 'kanban')
    readOrgPref('org-1', 'clientsView', 'basecrm.clientsView')

    // legacy key is gone; a different org must NOT inherit it anymore
    const secondOrgValue = readOrgPref('org-2', 'clientsView', 'basecrm.clientsView')
    expect(secondOrgValue).toBeNull()

    // the first org's adopted value is untouched by the second org's read
    expect(readOrgPref('org-1', 'clientsView')).toBe('kanban')
  })

  it('prefers an existing org-scoped value over the legacy key', () => {
    localStorage.setItem('basecrm.org-1.clientsView', 'list')
    localStorage.setItem('basecrm.clientsView', 'kanban')

    const value = readOrgPref('org-1', 'clientsView', 'basecrm.clientsView')

    expect(value).toBe('list')
    // legacy key is left alone since the org-scoped value already won
    expect(localStorage.getItem('basecrm.clientsView')).toBe('kanban')
  })

  it('returns null when neither the org key nor the legacy key exist', () => {
    expect(readOrgPref('org-1', 'clientsView', 'basecrm.clientsView')).toBeNull()
  })
})
