/**
 * Small colour helpers (sRGB hex <-> linear, OKLab, colour-vision-deficiency
 * simulation). Pure functions with no DOM or PixiJS dependency.
 */

export type Rgb = readonly [number, number, number]

/** '#rrggbb' -> [r, g, b] in 0..1 (gamma-encoded sRGB). */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** [r, g, b] in 0..1 -> '#rrggbb'. */
export function rgbToHex(rgb: Rgb): string {
  const to = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

/** '#rrggbb' -> 0xrrggbb. */
export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

/** Linear interpolation between two hex colours in sRGB space (t = 0 -> a). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** Multiplies a colour's channels by `k` (k < 1 darkens, k > 1 lightens toward white). */
export function shadeHex(hex: string, k: number): string {
  if (k <= 1) {
    const c = hexToRgb(hex)
    return rgbToHex([c[0] * k, c[1] * k, c[2] * k])
  }
  return mixHex(hex, '#ffffff', Math.min(1, k - 1))
}

/** Desaturates toward the colour's own luminance (t = 1 -> fully grey). */
export function desaturateHex(hex: string, t: number): string {
  const c = hexToRgb(hex)
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  return rgbToHex([c[0] + (l - c[0]) * t, c[1] + (l - c[1]) * t, c[2] + (l - c[2]) * t])
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Gamma-encoded sRGB -> linear sRGB. */
export function srgbToLinear(rgb: Rgb): Rgb {
  return [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])]
}

/** Linear sRGB -> OKLab [L, a, b]. */
export function linearToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export const VISION_TYPES = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const
export type VisionType = (typeof VISION_TYPES)[number]

/**
 * Machado, Oliveira & Fernandes (2009) simulation matrices at full severity,
 * applied to linear sRGB.
 */
const CVD_MATRICES: Record<VisionType, readonly (readonly [number, number, number])[]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

/** Simulates how a colour appears with a colour-vision deficiency (linear sRGB in and out). */
export function simulateVision(linear: Rgb, type: VisionType): Rgb {
  const m = CVD_MATRICES[type]
  const out = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const row = m[i] as readonly [number, number, number]
    out[i] = Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]))
  }
  return out as unknown as Rgb
}

/** Perceptual distance (OKLab Euclidean) between two hex colours as seen with `type` vision. */
export function perceivedDistance(a: string, b: string, type: VisionType = 'normal'): number {
  const la = linearToOklab(simulateVision(srgbToLinear(hexToRgb(a)), type))
  const lb = linearToOklab(simulateVision(srgbToLinear(hexToRgb(b)), type))
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}
