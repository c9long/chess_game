/**
 * Synthesised sound effects (WebAudio; no audio files, nothing to license).
 * The AudioContext is created lazily on the first sound after a user gesture
 * (`unlock()`), as browsers require.
 */

export type SoundKind =
  | 'move'
  | 'capture'
  | 'castle'
  | 'promotion'
  | 'defeat'
  | 'freeze'
  | 'turn'
  | 'end'
  | 'select'
  | 'illegal'

type AudioCtor = typeof AudioContext

export class SoundEngine {
  #ctx: AudioContext | null = null
  #master: GainNode | null = null
  #reverb: ConvolverNode | null = null
  #noise: AudioBuffer | null = null
  #enabled = true
  #volume = 0.6

  get enabled(): boolean {
    return this.#enabled
  }

  setEnabled(on: boolean): void {
    this.#enabled = on
  }

  setVolume(v: number): void {
    this.#volume = Math.min(1, Math.max(0, v))
    if (this.#master) this.#master.gain.value = this.#volume
  }

  /** Call from a user gesture (pointer/key event) so later sounds may play. */
  unlock(): void {
    if (!this.#enabled) return
    const ctx = this.#ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  #ensure(): AudioContext | null {
    if (this.#ctx) return this.#ctx
    const Ctor = (globalThis as { AudioContext?: AudioCtor }).AudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = this.#volume
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    master.connect(comp).connect(ctx.destination)
    // A short synthetic room impulse for a little air.
    const len = Math.floor(ctx.sampleRate * 0.9)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2
    }
    const reverb = ctx.createConvolver()
    reverb.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.22
    reverb.connect(wet).connect(master)
    const nlen = Math.floor(ctx.sampleRate * 0.5)
    const noise = ctx.createBuffer(1, nlen, ctx.sampleRate)
    const nd = noise.getChannelData(0)
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1
    this.#ctx = ctx
    this.#master = master
    this.#reverb = reverb
    this.#noise = noise
    return ctx
  }

  play(kind: SoundKind): void {
    if (!this.#enabled) return
    const ctx = this.#ensure()
    if (ctx?.state !== 'running') return
    const t = ctx.currentTime + 0.005
    switch (kind) {
      case 'move':
        this.#knock(t, 1, 1)
        break
      case 'castle':
        this.#knock(t, 1, 1)
        this.#knock(t + 0.09, 0.8, 1.12)
        break
      case 'capture':
        this.#knock(t, 1.25, 0.86)
        this.#knock(t + 0.035, 0.9, 1.3)
        this.#thump(t, 0.7)
        break
      case 'promotion':
        this.#chime(t + 0.12, [659.25, 830.61, 987.77, 1318.5], 0.07, 0.22)
        break
      case 'defeat':
        this.#fall(t + 0.05)
        break
      case 'freeze':
        this.#shimmer(t + 0.03)
        break
      case 'turn':
        this.#chime(t, [880, 1318.5], 0.05, 0.08)
        break
      case 'end':
        this.#chime(t + 0.25, [523.25, 659.25, 783.99, 1046.5], 0.11, 0.2)
        break
      case 'select':
        this.#tick(t, 0.12)
        break
      case 'illegal':
        this.#thump(t, 0.35)
        break
    }
  }

  #out(dry: number, wet: number): GainNode {
    const ctx = this.#ctx as AudioContext
    const g = ctx.createGain()
    const d = ctx.createGain()
    d.gain.value = dry
    g.connect(d).connect(this.#master as GainNode)
    if (wet > 0 && this.#reverb) {
      const w = ctx.createGain()
      w.gain.value = wet
      g.connect(w).connect(this.#reverb)
    }
    return g
  }

  /** Wooden knock: a filtered noise click plus a short pitched body. */
  #knock(t: number, gain: number, pitch: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(1, 0.35)
    const src = ctx.createBufferSource()
    src.buffer = this.#noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900 * pitch
    bp.Q.value = 1.6
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.55 * gain, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
    src.connect(bp).connect(ng).connect(out)
    src.start(t, Math.random() * 0.3, 0.06)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(240 * pitch, t)
    osc.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.09)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.004)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
    osc.connect(og).connect(out)
    osc.start(t)
    osc.stop(t + 0.14)
  }

  #thump(t: number, gain: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(1, 0.2)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.6 * gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  #tick(t: number, gain: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(1, 0.1)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1500, t)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.05)
  }

  #chime(t: number, freqs: readonly number[], spacing: number, gain: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(0.8, 0.7)
    freqs.forEach((f, i) => {
      const s = t + i * spacing
      for (const [mult, amp] of [
        [1, 1],
        [2.01, 0.28],
        [3.02, 0.1],
      ] as const) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = f * mult
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, s)
        g.gain.exponentialRampToValueAtTime(gain * amp, s + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0005, s + 0.9)
        osc.connect(g).connect(out)
        osc.start(s)
        osc.stop(s + 1)
      }
    })
  }

  #fall(t: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(0.9, 0.6)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, t)
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.9)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1400, t)
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.9)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0)
    osc.connect(lp).connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 1.05)
    this.#thump(t, 0.6)
  }

  #shimmer(t: number): void {
    const ctx = this.#ctx as AudioContext
    const out = this.#out(0.7, 0.8)
    const src = ctx.createBufferSource()
    src.buffer = this.#noise
    src.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5200
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
    src.connect(hp).connect(g).connect(out)
    src.start(t)
    src.stop(t + 0.75)
    this.#chime(t + 0.02, [1975.5, 2637, 2349.3], 0.06, 0.05)
  }

  destroy(): void {
    void this.#ctx?.close()
    this.#ctx = null
  }
}
