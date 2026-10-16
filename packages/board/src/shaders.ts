/**
 * GLSL sources (PixiJS GL programs: `in`/`out`, `finalColor`, `texture()`).
 * The board is drawn procedurally (no image assets): inlaid maple/walnut
 * squares with per-square grain, a rosewood frame with brass inlays and a
 * seat-coloured band along each home edge.
 */

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
uniform vec4 uGain;     // per-seat band dye brightness (S, W, N, E)
uniform float uSeed;

${NOISE}

// Wood with the grain running along w.x.
vec3 wood(vec2 w, vec3 base, float contrast, float seed, float freq) {
  w += seed * vec2(17.13, 31.7);
  float warp = fbm(w * vec2(0.3, 1.1));
  float ring = w.y * freq + warp * 2.2 + 0.8 * fbm(w * vec2(0.1, 0.4) + 5.0);
  float r = fract(ring);
  float late = smoothstep(0.0, 0.22, r) * (1.0 - smoothstep(0.62, 1.0, r));
  float fiber = vnoise(vec2(w.x * 1.1, w.y * 34.0));
  float pores = vnoise(vec2(w.x * 5.0, w.y * 110.0));
  float v = 1.0 - contrast * (1.0 - late) * 0.5;
  v *= 0.93 + 0.1 * fiber;
  v *= 0.97 + 0.05 * pores;
  v *= 0.9 + 0.18 * fbm(w * 0.16 + 3.0);
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
  vec2 q = (p - uFrame) / uSq;   // field is [0, 12]^2, y down (rank 12 at the top)
  float aa = uPx;
  vec3 col;

  float ox = max(-q.x, q.x - 12.0);
  float oy = max(-q.y, q.y - 12.0);
  float outside = max(ox, oy);

  if (outside <= 0.0) {
    // ---- playing field -------------------------------------------------
    vec2 cell = floor(q);
    vec2 f = q - cell;
    float file = cell.x;
    float rank = 11.0 - cell.y;
    bool dark = mod(file + rank, 2.0) < 0.5;
    float sid = hash12(cell + uSeed * 13.0);
    vec2 w = dark ? vec2(q.y, q.x) : q;
    vec3 base = (dark ? uDark : uLight) * (0.95 + 0.1 * sid);
    col = wood(w * vec2(0.8, 1.0) + sid * 9.0, base, dark ? 0.34 : 0.16, sid, dark ? 1.5 : 1.1);
    // Inlay seams between squares.
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    col *= mix(0.78, 1.0, smoothstep(0.0, 1.4 * aa, d));
    col *= 1.0 + 0.035 * (1.0 - smoothstep(1.4 * aa, 5.0 * aa, d));
    // Ambient occlusion where the field meets the raised frame.
    float e = min(min(q.x, 12.0 - q.x), min(q.y, 12.0 - q.y));
    col *= mix(0.72, 1.0, smoothstep(0.0, 0.2, e));
  } else {
    // ---- frame (mitred corners, grain along each edge) ------------------
    float t = outside / fw;     // 0 at the field, 1 at the outer edge
    int side;                   // 0 S (bottom), 1 W (left), 2 N (top), 3 E (right)
    if (ox > oy) side = q.x < 0.0 ? 1 : 3;
    else side = q.y > 12.0 ? 0 : 2;
    bool horiz = side == 0 || side == 2;
    float along = horiz ? q.x : q.y;
    vec2 w = horiz ? q : q.yx;
    col = wood(w * vec2(0.5, 1.4) + float(side) * 7.3, uWood, 0.55, float(side) + 1.0, 2.0);

    // Profile: a raised inner lip, a cove, a flat, and a rounded outer edge.
    float prof = 1.0;
    prof *= 1.0 + 0.22 * exp(-pow((t - 0.12) / 0.045, 2.0));
    prof *= 1.0 - 0.22 * exp(-pow((t - 0.22) / 0.05, 2.0));
    prof *= 1.0 + 0.14 * exp(-pow((t - 0.93) / 0.03, 2.0));
    prof *= mix(1.0, 0.5, smoothstep(0.955, 1.0, t));
    col *= prof;

    // Seat band: dyed inlay along the home edge with brass borders.
    vec3 seat = side == 0 ? uSeatS : side == 1 ? uSeatW : side == 2 ? uSeatN : uSeatE;
    float gain = side == 0 ? uGain.x : side == 1 ? uGain.y : side == 2 ? uGain.z : uGain.w;
    float t0 = 0.5;
    float t1 = 0.76;
    float endA = 0.18;
    float endB = 11.82;
    float inBand = band(t, t0, t1, aa / fw) * band(along, endA, endB, aa);
    float lum = dot(col, vec3(0.299, 0.587, 0.114)) / max(0.001, dot(uWood, vec3(0.299, 0.587, 0.114)));
    vec3 dyed = mix(col, seat * (0.42 + 0.42 * lum) * gain, 0.72 + 0.18 * clamp(gain - 1.0, 0.0, 1.0));
    dyed *= 0.82 + 0.22 * exp(-pow((t - (t0 + 0.07)) / 0.06, 2.0));
    dyed *= 1.0 - 0.25 * smoothstep(t1 - 0.1, t1, t);
    col = mix(col, dyed, inBand);
    float rim = band(t, t0 - 0.018, t0, aa / fw) + band(t, t1, t1 + 0.018, aa / fw);
    rim *= band(along, endA - 0.02, endB + 0.02, aa);
    float brassN = 0.85 + 0.3 * vnoise(p * 0.7);
    col = mix(col, uBrass * brassN, clamp(rim, 0.0, 1.0) * 0.75);

    // Brass inlay lines at the field edge and near the outer edge.
    float inner = band(t, 0.025, 0.06, aa / fw);
    float outerL = band(t, 0.975, 0.99, aa / fw);
    col = mix(col, uBrass * (0.9 + 0.25 * vnoise(p * 0.9)), max(inner, outerL * 0.8));

    // Mitre joint.
    col *= mix(0.6, 1.0, smoothstep(0.0, 1.2 * aa, abs(ox - oy)));
  }

  // Outer silhouette: rounded corners, anti-aliased.
  float sd = sdRoundBox(q - 6.0, vec2(6.0 + fw), 0.16);
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
