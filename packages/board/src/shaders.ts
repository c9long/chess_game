/**
 * GLSL sources (PixiJS GL programs: `in`/`out`, `finalColor`, `texture()`).
 * The board is drawn procedurally (no image assets): pale maple and dark walnut
 * squares with per-square grain, a walnut frame with a brass inlay line round
 * the field, and a brass-edged enamel banner in the seat colour along each home edge.
 */

import { BOARD_SIZE } from './geometry.ts'

/** Board size and half size as GLSL float literals. */
const N = BOARD_SIZE.toFixed(1)
const HALF = (BOARD_SIZE / 2).toFixed(1)

/**
 * The seat banner's inner and outer edges, as fractions of the frame width out from the field.
 * The coordinates sit between the field and the banner; BoardView places the turn glow and
 * the dims over the same strip.
 */
export const BAND_INNER = 0.55
export const BAND_OUTER = 0.79
const BAND_T0 = BAND_INNER.toFixed(3)
const BAND_T1 = BAND_OUTER.toFixed(3)

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`

export const BOARD_VERTEX = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`

export const BOARD_FRAGMENT = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;

uniform vec2 uSize;     // full board size incl. frame, CSS px
uniform float uSq;      // square size, CSS px
uniform float uFrame;   // frame width, CSS px
uniform float uPx;      // one device pixel in square units
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec3 uWood;
uniform vec3 uBrass;
uniform vec3 uSeatS;
uniform vec3 uSeatW;
uniform vec3 uSeatN;
uniform vec3 uSeatE;
uniform float uSeed;

${NOISE}

// Wood with the grain running along w.x. 'contrast' sets the figure (growth rings), 'fine'
// the fibre and pore texture; both drop on small squares, where they only read as noise.
vec3 wood(vec2 w, vec3 base, float contrast, float fine, float seed, float freq) {
  w += seed * vec2(17.13, 31.7);
  float warp = fbm(w * vec2(0.3, 1.1));
  float ring = w.y * freq + warp * 2.2 + 0.8 * fbm(w * vec2(0.1, 0.4) + 5.0);
  float r = fract(ring);
  float late = smoothstep(0.0, 0.22, r) * (1.0 - smoothstep(0.62, 1.0, r));
  float fiber = vnoise(vec2(w.x * 1.1, w.y * 34.0));
  float pores = vnoise(vec2(w.x * 5.0, w.y * 110.0));
  float v = 1.0 - contrast * (1.0 - late) * 0.5;
  v *= 1.0 + fine * (0.1 * fiber - 0.05);
  v *= 1.0 + fine * (0.05 * pores - 0.025);
  v *= 0.94 + 0.12 * fbm(w * 0.16 + 3.0);
  return base * v;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float band(float x, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x));
}

void main() {
  vec2 p = vUV * uSize;
  float fw = uFrame / uSq;
  vec2 q = (p - uFrame) / uSq;   // field is [0, N]^2 (N = board size), y down (rank N at the top)
  float aa = uPx;
  // Wood figure is kept quiet on phone-sized squares so the pieces stay the strongest shapes.
  float detail = smoothstep(16.0, 44.0, uSq);
  vec3 col;

  float ox = max(-q.x, q.x - ${N});
  float oy = max(-q.y, q.y - ${N});
  float outside = max(ox, oy);

  if (outside <= 0.0) {
    // ---- playing field: pale maple and dark walnut -----------------------
    vec2 cell = floor(q);
    vec2 f = q - cell;
    float file = cell.x;
    float rank = ${N} - 1.0 - cell.y;
    bool dark = mod(file + rank, 2.0) < 0.5;
    float sid = hash12(cell + uSeed * 13.0);
    vec2 w = dark ? vec2(q.y, q.x) : q;
    vec3 base = (dark ? uDark : uLight) * (0.97 + 0.06 * sid);
    // Maple is kept smoother than walnut: its fibre would read as streaks behind the pieces.
    float figure = (dark ? 0.24 : 0.08) * mix(0.45, 1.0, detail);
    float fine = (dark ? 1.0 : 0.5) * mix(0.4, 1.0, detail);
    col = wood(w * vec2(0.8, 1.0) + sid * 9.0, base, figure, fine, sid, dark ? 1.5 : 1.1);
    // Fine inlay seams between squares.
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    col *= mix(0.88, 1.0, smoothstep(0.0, 1.2 * aa, d));
    // Ambient occlusion where the field meets the frame.
    float e = min(min(q.x, ${N} - q.x), min(q.y, ${N} - q.y));
    col *= mix(0.8, 1.0, smoothstep(0.0, 0.14, e));
  } else {
    // ---- walnut frame (mitred corners, grain along each edge) ------------
    float t = outside / fw;     // 0 at the field, 1 at the outer edge
    float ta = aa / fw;         // one device pixel in frame units
    int side;                   // 0 S (bottom), 1 W (left), 2 N (top), 3 E (right)
    if (ox > oy) side = q.x < 0.0 ? 1 : 3;
    else side = q.y > ${N} ? 0 : 2;
    bool horiz = side == 0 || side == 2;
    float along = horiz ? q.x : q.y;
    vec2 w = horiz ? q : q.yx;
    col = wood(w * vec2(0.5, 1.4) + float(side) * 7.3, uWood, 0.4, mix(0.5, 1.0, detail),
      float(side) + 1.0, 2.0);

    // Profile: a shadowed fillet at the field, a flat rail, a rounded outer edge.
    float prof = mix(0.62, 1.0, smoothstep(0.0, 0.07, t));
    prof *= 1.0 + 0.1 * exp(-pow((t - 0.9) / 0.035, 2.0));
    prof *= mix(1.0, 0.55, smoothstep(0.95, 1.0, t));
    col *= prof;

    // The brass inlay line (stringing) right round the field, at least ~1.3 device px wide.
    float i0 = 0.035;
    float i1 = i0 + max(0.045, 1.3 * ta);
    float brassN = 0.9 + 0.2 * vnoise(p * 0.8);
    float inlay = band(t, i0, i1, ta);
    col = mix(col, uBrass * brassN * 1.05, inlay);

    // Seat banner: a strip of flat enamel in the seat colour along the home edge, edged with
    // brass hairlines like the nameplates.
    vec3 seat = side == 0 ? uSeatS : side == 1 ? uSeatW : side == 2 ? uSeatN : uSeatE;
    float t0 = ${BAND_T0};
    float t1 = ${BAND_T1};
    float endA = 0.18;
    float endB = ${N} - 0.18;
    float ends = band(along, endA, endB, aa);
    float inBand = band(t, t0, t1, ta) * ends;
    float across = clamp((t - t0) / (t1 - t0), 0.0, 1.0);
    // Enamel: a faint convex sheen across, a darker lower lip, a little surface variation.
    vec3 enamel = seat * (0.9 + 0.16 * exp(-pow((across - 0.38) / 0.22, 2.0)));
    enamel *= 1.0 - 0.18 * smoothstep(0.7, 1.0, across);
    enamel *= 0.98 + 0.04 * vnoise(vec2(along * 6.0, across * 3.0));
    col = mix(col, enamel, inBand);
    float hw = max(0.022, 1.0 * ta);
    float rim = band(t, t0 - hw, t0, ta) + band(t, t1, t1 + hw, ta);
    rim *= band(along, endA - 0.02, endB + 0.02, aa);
    col = mix(col, uBrass * brassN, clamp(rim, 0.0, 1.0) * 0.9);

    // Mitre joint.
    col *= mix(0.72, 1.0, smoothstep(0.0, 1.2 * aa, abs(ox - oy)));
  }

  // Outer silhouette: rounded corners, anti-aliased.
  float sd = sdRoundBox(q - ${HALF}, vec2(${HALF} + fw), 0.12);
  float alpha = 1.0 - smoothstep(-aa, aa, sd);
  finalColor = vec4(col * alpha, alpha);
}
`

/** Noise-threshold dissolve with a glowing edge (army removal). */
export const DISSOLVE_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uProgress;
uniform vec3 uEdge;
uniform vec2 uCenter;
uniform float uDelay;

${NOISE}

void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 px = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  // The burn spreads outward from uCenter: uDelay progress per pixel of distance.
  float prog = clamp(uProgress - length(px - uCenter) * uDelay, 0.0, 1.0);
  float n = fbm(px * 0.022) * 0.85 + vnoise(px * 0.25) * 0.15;
  float t = prog * 1.3 - 0.15;
  float keep = smoothstep(t, t + 0.05, n);
  float edge = 1.0 - smoothstep(0.0, 0.07, abs(n - t - 0.03));
  edge *= step(0.001, prog) * (1.0 - smoothstep(0.85, 1.0, prog));
  vec3 rgb = c.rgb * keep + uEdge * edge * c.a * 1.6;
  finalColor = vec4(rgb, c.a * max(keep, edge * 0.9));
}
`
