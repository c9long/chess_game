import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNative, isNativeBuild, platform } from './platform.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('platform', () => {
  it('is the web in a plain browser', () => {
    vi.stubEnv('VITE_NATIVE', '')
    vi.stubGlobal('window', {})
    expect(isNativeBuild()).toBe(false)
    expect(isNative()).toBe(false)
    expect(platform()).toBe('web')
  })

  it('detects the Capacitor shells without a dependency', () => {
    vi.stubEnv('VITE_NATIVE', '')
    vi.stubGlobal('window', {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
    })
    expect(isNative()).toBe(true)
    expect(platform()).toBe('ios')
    vi.stubGlobal('window', {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    })
    expect(platform()).toBe('android')
    // Capacitor's web fallback (not native) is still the web.
    vi.stubGlobal('window', {
      Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
    })
    expect(isNative()).toBe(false)
    expect(platform()).toBe('web')
  })

  it('treats a VITE_NATIVE build as native before the bridge exists', () => {
    vi.stubEnv('VITE_NATIVE', '1')
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 })
    expect(isNativeBuild()).toBe(true)
    expect(isNative()).toBe(true)
    expect(platform()).toBe('android')
  })
})
