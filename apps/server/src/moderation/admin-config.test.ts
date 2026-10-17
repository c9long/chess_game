import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../config.ts'

const base = { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

describe('ADMIN_USER_IDS', () => {
  it('is empty by default: nobody is an admin', () => {
    expect(loadConfig(base).adminUserIds).toEqual([])
    expect(loadConfig({ ...base, ADMIN_USER_IDS: '' }).adminUserIds).toEqual([])
  })

  it('parses a comma list, trimming and dropping duplicates and blanks', () => {
    const c = loadConfig({ ...base, ADMIN_USER_IDS: ' abc123 , XyZ_-9,,abc123 ' })
    expect(c.adminUserIds).toEqual(['abc123', 'XyZ_-9'])
  })

  it('refuses entries that are not user ids', () => {
    expect(() => loadConfig({ ...base, ADMIN_USER_IDS: 'ok1,not an id' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, ADMIN_USER_IDS: 'a@b.c' })).toThrow(/ADMIN_USER_IDS/)
  })
})
