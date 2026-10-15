import { Container, Sprite, type Texture } from 'pixi.js'

/**
 * Pooled particles (sparks, dust, embers, ice). Particle state lives in typed
 * arrays; sprites are recycled, so bursts never allocate during frames.
 */
export class Particles {
  readonly container = new Container()
  readonly #sprites: Sprite[] = []
  readonly #vx: Float32Array
  readonly #vy: Float32Array
  readonly #life: Float32Array
  readonly #max: Float32Array
  readonly #drag: Float32Array
  readonly #grav: Float32Array
  readonly #s0: Float32Array
  readonly #s1: Float32Array
  readonly #a0: Float32Array
  readonly #spin: Float32Array
  readonly #capacity: number
  #cursor = 0
  #active = 0

  constructor(capacity: number) {
    this.#capacity = capacity
    this.#vx = new Float32Array(capacity)
    this.#vy = new Float32Array(capacity)
    this.#life = new Float32Array(capacity)
    this.#max = new Float32Array(capacity)
    this.#drag = new Float32Array(capacity)
    this.#grav = new Float32Array(capacity)
    this.#s0 = new Float32Array(capacity)
    this.#s1 = new Float32Array(capacity)
    this.#a0 = new Float32Array(capacity)
    this.#spin = new Float32Array(capacity)
    for (let i = 0; i < capacity; i++) {
      const s = new Sprite()
      s.anchor.set(0.5)
      s.visible = false
      s.blendMode = 'add'
      this.#sprites.push(s)
      this.container.addChild(s)
    }
  }

  get active(): number {
    return this.#active
  }

  /**
   * Emits one particle. Units are CSS px and seconds; `size` is the sprite
   * width at birth, shrinking/growing to `size * endScale`.
   */
  emit(
    texture: Texture,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    tint: number,
    opts: {
      endScale?: number
      drag?: number
      gravity?: number
      alpha?: number
      spin?: number
      blend?: 'add' | 'normal'
    } = {},
  ): void {
    const i = this.#cursor
    this.#cursor = (this.#cursor + 1) % this.#capacity
    const s = this.#sprites[i] as Sprite
    if (!s.visible) this.#active++
    s.texture = texture
    s.visible = true
    s.position.set(x, y)
    s.tint = tint
    s.blendMode = opts.blend ?? 'add'
    s.rotation = Math.random() * Math.PI * 2
    const base = size / Math.max(1, texture.width)
    s.scale.set(base)
    s.alpha = opts.alpha ?? 1
    this.#vx[i] = vx
    this.#vy[i] = vy
    this.#life[i] = 0
    this.#max[i] = life
    this.#drag[i] = opts.drag ?? 2
    this.#grav[i] = opts.gravity ?? 0
    this.#s0[i] = base
    this.#s1[i] = base * (opts.endScale ?? 0.2)
    this.#a0[i] = opts.alpha ?? 1
    this.#spin[i] = opts.spin ?? 0
  }

  /** Advances particles by `dt` seconds. */
  update(dt: number): void {
    if (this.#active === 0) return
    for (let i = 0; i < this.#capacity; i++) {
      const s = this.#sprites[i] as Sprite
      if (!s.visible) continue
      const life = (this.#life[i] as number) + dt
      const max = this.#max[i] as number
      if (life >= max) {
        s.visible = false
        this.#active--
        continue
      }
      this.#life[i] = life
      const k = life / max
      const drag = Math.exp(-(this.#drag[i] as number) * dt)
      const vx = (this.#vx[i] as number) * drag
      const vy = (this.#vy[i] as number) * drag + (this.#grav[i] as number) * dt
      this.#vx[i] = vx
      this.#vy[i] = vy
      s.x += vx * dt
      s.y += vy * dt
      s.rotation += (this.#spin[i] as number) * dt
      const sc = (this.#s0[i] as number) + ((this.#s1[i] as number) - (this.#s0[i] as number)) * k
      s.scale.set(sc)
      s.alpha = (this.#a0[i] as number) * (1 - k * k)
    }
  }

  clear(): void {
    for (const s of this.#sprites) s.visible = false
    this.#active = 0
  }
}
