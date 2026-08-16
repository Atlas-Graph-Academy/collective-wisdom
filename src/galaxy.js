/**
 * The galaxy generator.
 *
 * Deliberately free of any `three` import: it runs inside a Web Worker (see
 * galaxy.worker.js), and pulling three into the worker bundle would cost more
 * load time than the generator saves.
 *
 * A barred spiral built from the standard structural components, each with
 * its real profile, rather than from one tuned density field:
 *
 *   nucleus   a handful of large sprites for the unresolved central blaze
 *   bulge     Sérsic spheroid, slightly flattened, cream-coloured
 *   bar       Ferrers ellipsoid — density (1 - (a/A)²)², which holds nearly
 *             constant along most of its length and collapses at the tips.
 *             This is what makes a bar read as a bar and not as a blob.
 *   disc      exponential surface brightness, sampled uniformly over area so
 *             the outskirts stay as finely grained as the middle; the
 *             exponential lives in per-star brightness
 *   arms      logarithmic spirals as a density *bias* plus a directly-sampled
 *             ridge population for the crisp bright strands
 *   HII       pink star-forming knots strung in chains along the arm ridges
 *   haze      a thin layer of wide dim sprites for unresolved light
 *   halo      sparse faint stars off the plane, so the tilted disc sits in a
 *             volume instead of on a sheet
 *
 * Absorption is a separate multiplicative pass (`galaxyDust`): thin ragged
 * filaments riding the inner edges of the arms. Its shader attenuates each
 * channel differently, so thin dust reddens what shines through and only the
 * deepest lanes go dark.
 *
 * Performance shape: the density and dust fields are noise-heavy (tens of
 * octaves per evaluation), and rejection sampling evaluates them a few times
 * per accepted star — several million times for a full field, which was ~15s
 * on the main thread. They are now evaluated ONCE onto a polar grid
 * (`buildGalaxyGrid`) and every sample is a bilinear lookup. Same statistics,
 * ~30x less work, and the whole thing runs off-thread anyway.
 */

// The disc is generated flat in XZ and then pitched towards the camera by this
// much. Without it a disc in the camera's line of sight is just a bright line.
export const GALAXY_TILT = -1.12

// Unit normal of the tilted disc, in the galaxy's own frame. The generators
// bake the tilt into positions, so this is what the shaders need to know which
// way the sheet faces. Plain array — no three here.
export const GALAXY_NORMAL = [0, Math.cos(GALAXY_TILT), Math.sin(GALAXY_TILT)]

// Colours are packed to 8 bits with this much headroom above 1.0, so the few
// stars that overshoot white still carry the extra energy into bloom.
export const COLOR_RANGE = 2.0

// Sprite sizes are packed to 8 bits over this range, in CSS px.
export const SIZE_RANGE = 32.0

// All lengths are fractions of the disc radius.
const BAR_ANGLE = -0.42
const BAR_A = 0.31   // half-length
const BAR_B = 0.095  // in-plane half-width
const BAR_C = 0.075  // vertical half-thickness

const BULGE_RE = 0.10

// Exponential disc scale length. Surface brightness falls as exp(-r/h).
const SCALE_LENGTH = 0.34

// Radial extent of the lookup grid, in radii. Nothing is sampled beyond it.
const GRID_RMAX = 1.30

/**
 * Two majors springing from the ends of the bar, two minors between them, and
 * a set of windowed spurs. The spurs are what carry the fine structure: an arm
 * in a real galaxy is a bundle of strands, and ten narrow segments at slightly
 * different pitches read as that bundle where four fat ribbons never do.
 */
const ARMS = [
  { phase: 0.00,          pitch: 0.250, weight: 1.00, width: 1.35, from: 0.30, to: 1.16, major: true },
  { phase: Math.PI,       pitch: 0.244, weight: 0.95, width: 1.35, from: 0.30, to: 1.10, major: true },

  { phase: 0.55*Math.PI,  pitch: 0.280, weight: 0.50, width: 0.78, from: 0.38,  to: 1.00, major: false },
  { phase: 1.50*Math.PI,  pitch: 0.268, weight: 0.46, width: 0.78, from: 0.44,  to: 1.04, major: false },

  { phase: 0.20*Math.PI,  pitch: 0.300, weight: 0.30, width: 0.50, from: 0.34,  to: 0.72, major: false },
  { phase: 0.84*Math.PI,  pitch: 0.222, weight: 0.28, width: 0.46, from: 0.50,  to: 0.90, major: false },
  { phase: 1.16*Math.PI,  pitch: 0.315, weight: 0.29, width: 0.48, from: 0.60,  to: 1.06, major: false },
  { phase: 1.80*Math.PI,  pitch: 0.235, weight: 0.27, width: 0.44, from: 0.30,  to: 0.66, major: false },
  { phase: 0.44*Math.PI,  pitch: 0.205, weight: 0.24, width: 0.42, from: 0.66,  to: 1.10, major: false },
  { phase: 1.34*Math.PI,  pitch: 0.330, weight: 0.23, width: 0.42, from: 0.42,  to: 0.82, major: false }
]

// Light that survives between the arms. Real inter-arm gaps are plainly lit.
const INTERARM = 0.36

const COLOR_NUCLEUS = rgb(0xFFF7E6)
const COLOR_BULGE = rgb(0xFFDDA8)
const COLOR_BAR = rgb(0xFFD59A)
const COLOR_INNER = rgb(0xFFE8C8)
const COLOR_ARM = rgb(0xBDD2F8)
const COLOR_RIM = rgb(0x9AB4E4)
const COLOR_STAR = rgb(0xF4F7FF)
const COLOR_HII = rgb(0xFF7FA4)
const COLOR_HII_BRIGHT = rgb(0xFFC0D0)

// ---------------------------------------------------------------------------
// Small maths. Local so the worker bundle stays tiny.
// ---------------------------------------------------------------------------

function rgb(hex) {
  return [((hex >> 16) & 255)/255, ((hex >> 8) & 255)/255, (hex & 255)/255]
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x
}

function smoothstep(x, a, b) {
  if (x <= a) return 0
  if (x >= b) return 1

  const t = (x - a)/(b - a)

  return t*t*(3 - 2*t)
}

function gaussian() {
  let u = 0
  let v = 0

  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()

  return Math.sqrt(-2*Math.log(u))*Math.cos(Math.PI*2*v)
}

function wrapPi(angle) {
  const t = (angle + Math.PI)%(Math.PI*2)

  return (t < 0 ? t + Math.PI*2 : t) - Math.PI
}

/**
 * Integer lattice hash → [0, 1). The usual sin(dot)*43758 trick is a
 * transcendental per call and dominated the noise cost; this is a few integer
 * ops with the same statistical quality for our purposes.
 */
function hash2(xi, yi) {
  let h = (xi*374761393 + yi*668265263) | 0

  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16

  return (h >>> 0)/4294967296
}

function valueNoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  const u = xf*xf*(3 - 2*xf)
  const v = yf*yf*(3 - 2*yf)

  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)

  return (a + (b - a)*u) + ((c - a) + (a - b - c + d)*u)*v
}

function fbm(x, y, octaves) {
  let value = 0
  let amplitude = 0.5
  let total = 0

  for (let o = 0; o < octaves; o++) {
    value += amplitude*valueNoise(x, y)
    total += amplitude

    x *= 2.07
    y *= 2.07
    amplitude *= 0.5
  }

  return value/total
}

/**
 * Ridged fractal noise — the noise is folded about its midpoint so the creases
 * become sharp ridges. Ordinary fbm makes an arm lumpy; folded noise makes it
 * filamentary, which is the texture the reference is actually made of.
 */
function ridged(x, y, octaves) {
  let value = 0
  let amplitude = 0.5
  let total = 0

  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2*valueNoise(x, y) - 1)

    value += amplitude*n*n
    total += amplitude

    x *= 2.13
    y *= 2.13
    amplitude *= 0.5
  }

  return value/total
}

// ---------------------------------------------------------------------------
// Arm geometry
// ---------------------------------------------------------------------------

/**
 * Angular half-width of an arm at radius r. Constant physical width, capped so
 * the roots don't balloon into blobs.
 */
function armSigma(arm, r, radius) {
  return arm.width*Math.min(0.30, 0.070*radius/r + 0.060)
}

/**
 * Where the arm's ridge sits at radius r.
 *
 * A logarithmic spiral, but with a pitch that opens up near the root: arms
 * leave the ends of a bar nearly tangentially and only settle to their
 * asymptotic pitch a little way out. A constant pitch from r0 makes the inner
 * segment curl into a near-ring around the hub, which is the single most
 * "drawn" thing a spiral can do. dtheta/dr = 1/(r tan(pitch(r))), integrated
 * numerically once per arm and cached.
 */
const ARM_TABLE_N = 96

function armTable(arm) {
  if (arm.table) return arm.table

  const table = new Float32Array(ARM_TABLE_N)
  const r0 = arm.from
  const r1 = arm.to*1.05
  const dr = (r1 - r0)/(ARM_TABLE_N - 1)

  let theta = 0

  for (let n = 0; n < ARM_TABLE_N; n++) {
    const r = r0 + n*dr
    const opening = Math.exp(-(r - r0)/0.11)
    const pitch = arm.pitch + (0.62 - arm.pitch)*opening

    table[n] = theta
    theta += dr/(r*Math.tan(pitch))
  }

  arm.table = table
  arm.tableStep = dr

  return table
}

function armTheta(arm, r, radius) {
  const table = armTable(arm)
  const f = clamp((r/radius - arm.from)/arm.tableStep, 0, ARM_TABLE_N - 1.001)
  const n = Math.floor(f)
  const t = f - n

  return BAR_ANGLE + arm.phase + table[n]*(1 - t) + table[n + 1]*t
}

function armSpan(arm, r, radius) {
  return smoothstep(r, arm.from*radius, (arm.from + 0.10)*radius)*
    (1 - smoothstep(r, (arm.to - 0.24)*radius, arm.to*radius))
}

/**
 * Exponential surface brightness with a soft outer dissolve. Sampling is
 * uniform over area; this profile is applied to *brightness* (and partially to
 * acceptance), which keeps the rim as finely grained as the centre.
 */
function discProfile(r, radius, scale = SCALE_LENGTH) {
  const taper = 1 - smoothstep(r, radius*0.82, radius*1.20)

  return Math.exp(-r/(scale*radius))*taper
}

/**
 * The disc grain's radial weight. The disc proper starts outside the bar:
 * inside it the light is the bar's, and grain piled on top just rounds the
 * hub back into a blob.
 */
function grainProfile(r, radius) {
  return Math.sqrt(discProfile(r, radius))*(0.15 + 0.85*smoothstep(r, radius*0.14, radius*0.36))
}

// ---------------------------------------------------------------------------
// Fields. Evaluated once per grid cell by buildGalaxyGrid, never per star.
// ---------------------------------------------------------------------------

/**
 * Stellar surface density from the arms at (r, theta), relative to the smooth
 * disc. Returns both the coarse value (what the haze sees — frequencies below
 * a sprite's own footprint cannot render as texture, only as speckle) and the
 * fine value (what the resolved stars see).
 */
function armField(r, theta, radius, out) {
  let coarse = 0
  let fine = 0

  for (let i = 0; i < ARMS.length; i++) {
    const arm = ARMS[i]
    const span = armSpan(arm, r, radius)

    if (span < 0.01) continue

    const sigma = armSigma(arm, r, radius)
    const ridge = armTheta(arm, r, radius)
    const u = wrapPi(theta - ridge)
    const t = u/sigma

    if (Math.abs(t) > 3.2) continue

    let amp = arm.weight*span*Math.exp(-0.5*t*t)*(0.15 + 0.85*smoothstep(r, arm.from*radius, (arm.from + 0.30)*radius))

    // The winding coordinate: distance along the arm, in radians of sweep.
    const w = ridge - BAR_ANGLE - arm.phase

    // Strands. Sampled in the arm's own frame so the texture shears with it.
    amp *= 0.25 + 1.9*ridged(u*2.3 + i*13.7, w*1.35, 4)

    // Bright knot where the major arms take off from the bar ends.
    if (arm.major) {
      amp *= 1 - 0.35*Math.exp(-Math.pow((r - arm.from*radius)/(0.10*radius), 2))
    }

    coarse += amp
    fine += amp*(0.40 + 1.30*ridged(u*8.0 + i*41.7, w*5.2, 3))
  }

  out.coarse = coarse
  out.fine = fine
}

/**
 * Inter-arm floor: dim light with its own faint strands, so the gaps read as
 * thinly starred space instead of flat grey. The strand modulation fades out
 * towards the hub — the winding coordinate is logarithmic and sweeps
 * arbitrarily fast at small r, which otherwise speckles the bulge.
 */
function floorField(r, theta, radius, x, z, out) {
  const strands = smoothstep(r, radius*0.16, radius*0.46)
  const w0 = Math.log(Math.max(r, 1e-4)/(0.295*radius))/Math.tan(0.25)

  const f = 1 + strands*(1.35*ridged(wrapPi(theta - w0)*1.5, w0*1.05 + 51.3, 3) - 0.55)

  // The floor thins outward faster than the arms do, so the outer disc is
  // arms on dark rather than a uniform speckled plate.
  const base = INTERARM*Math.max(0, f)*(1 - 0.55*smoothstep(r, radius*0.45, radius*1.05))

  out.coarse = base

  // Fine cartesian salt over everything, seam-free.
  out.fine = base*(0.55 + 0.95*ridged(x*11/radius, z*11/radius, 3))
}

/**
 * Optical depth of the dust at (r, theta):
 *
 *  - lanes hugging the inner edge of each arm, broken into filament segments
 *    by ridged noise so they never read as continuous drawn strokes
 *  - feathering: thin streaks crossing the arms at a shallow angle
 */
function dustTau(r, theta, radius) {
  let tau = 0

  for (let i = 0; i < ARMS.length; i++) {
    const arm = ARMS[i]
    const span = armSpan(arm, r, radius)

    if (span < 0.01) continue

    const sigma = armSigma(arm, r, radius)
    const ridge = armTheta(arm, r, radius)
    const u = wrapPi(theta - ridge)

    if (Math.abs(u) > sigma*3.5) continue

    const w = ridge - BAR_ANGLE - arm.phase

    // The lane rides the inner edge of the arm, displaced and broken by noise.
    const wobble = (fbm(w*2.6 + i*7.1, 3.3, 3) - 0.5)*0.8
    const lane = Math.exp(-0.5*Math.pow((u/sigma + 0.95 + wobble)/0.24, 2))

    // Coverage gate: the lane only exists where this noise crests, which is
    // what breaks it from a groove into a chain of filaments.
    const broken = smoothstep(ridged(w*4.4 + i*17.3, 0.7, 3), 0.40, 0.74)

    tau += 0.55*arm.weight*span*lane*broken*(0.55 + 0.9*ridged(u*6.0 + i*29.1, w*4.4, 3))

    // Feathers: fine streaks leaning across the arm.
    const feather = ridged(u*5.5 + w*2.1 + i*57.7, w*1.1 - u*2.6, 3)

    tau += 0.38*arm.weight*span*Math.exp(-0.5*Math.pow(u/(sigma*1.6), 2))*
      Math.max(0, feather - 0.62)*3.2
  }

  // Keep the nucleus and the far outskirts clean.
  tau *= smoothstep(r, radius*0.13, radius*0.30)*
    (1 - smoothstep(r, radius*0.80, radius*1.02))

  return tau
}

// ---------------------------------------------------------------------------
// The lookup grid
// ---------------------------------------------------------------------------

/**
 * Polar grid of the four field values, r in [0, GRID_RMAX·R] × theta in
 * [0, 2π). Cells are ~0.0045R × 0.007rad, finer than anything the noise
 * produces at the sprite scale, and every sample interpolates bilinearly so no
 * cell structure shows.
 *
 * Channels: 0 = fine density (floor + arms), 1 = coarse density,
 *           2 = fine arm share (for colouring), 3 = dust optical depth.
 */
export const GRID_NR = 288
export const GRID_NT = 896

export function buildGalaxyGrid(radius) {
  const data = new Float32Array(GRID_NR*GRID_NT*4)

  const arms = { coarse: 0, fine: 0 }
  const floor = { coarse: 0, fine: 0 }

  const dr = GRID_RMAX*radius/GRID_NR
  const dt = Math.PI*2/GRID_NT

  for (let ir = 0; ir < GRID_NR; ir++) {
    // Cell centres, so nothing sits exactly on r = 0.
    const r = (ir + 0.5)*dr

    for (let it = 0; it < GRID_NT; it++) {
      const theta = it*dt
      const x = Math.cos(theta)*r
      const z = Math.sin(theta)*r

      armField(r, theta, radius, arms)
      floorField(r, theta, radius, x, z, floor)

      const o = (ir*GRID_NT + it)*4

      data[o + 0] = floor.fine + arms.fine
      data[o + 1] = floor.coarse + arms.coarse
      data[o + 2] = arms.fine
      data[o + 3] = dustTau(r, theta, radius)
    }
  }

  return { data, radius }
}

/**
 * Bilinear sample of one channel. Theta wraps; r clamps at the rim.
 */
function sampleGrid(grid, r, theta, channel) {
  const fr = clamp(r/(GRID_RMAX*grid.radius)*GRID_NR - 0.5, 0, GRID_NR - 1.001)
  const ir = Math.floor(fr)
  const tr = fr - ir

  let ft = (theta/(Math.PI*2))*GRID_NT
  ft -= Math.floor(ft/GRID_NT)*GRID_NT

  const it0 = Math.floor(ft)
  const tt = ft - it0
  const it1 = (it0 + 1)%GRID_NT

  const d = grid.data
  const row0 = ir*GRID_NT
  const row1 = (ir + 1)*GRID_NT

  const a = d[(row0 + it0)*4 + channel]
  const b = d[(row0 + it1)*4 + channel]
  const c = d[(row1 + it0)*4 + channel]
  const e = d[(row1 + it1)*4 + channel]

  return (a + (b - a)*tt)*(1 - tr) + (c + (e - c)*tt)*tr
}

/**
 * Importance sampler over grid cells. Rejection sampling against a field that
 * is mostly near zero (dust: ~5% acceptance) or against a steep profile (disc
 * grain: ~20%) throws away most of its work; drawing the *cell* by cumulative
 * weight and jittering inside it never rejects. `weight(ir, it, r)` returns
 * the unnormalised probability of a cell; area (∝ r) is folded in here.
 */
function buildCellSampler(grid, weight) {
  const n = GRID_NR*GRID_NT
  const cdf = new Float64Array(n)
  const dr = GRID_RMAX*grid.radius/GRID_NR

  let total = 0

  for (let ir = 0; ir < GRID_NR; ir++) {
    const r = (ir + 0.5)*dr

    for (let it = 0; it < GRID_NT; it++) {
      const w = Math.max(0, weight(ir, it, r))*r

      total += w
      cdf[ir*GRID_NT + it] = total
    }
  }

  return { cdf, total, dr, dt: Math.PI*2/GRID_NT }
}

/**
 * Draws a cell, then a uniform position inside it. Returns via `out` to avoid
 * an allocation per star.
 */
function sampleCell(sampler, out) {
  const { cdf, total } = sampler
  const target = Math.random()*total

  let lo = 0
  let hi = cdf.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >>> 1

    if (cdf[mid] < target) lo = mid + 1
    else hi = mid
  }

  const ir = Math.floor(lo/GRID_NT)
  const it = lo - ir*GRID_NT

  // Uniform over the cell's area: r ∝ sqrt within the annulus slice.
  const r0 = ir*sampler.dr
  const r1 = r0 + sampler.dr

  out.r = Math.sqrt(r0*r0 + Math.random()*(r1*r1 - r0*r0))
  out.theta = (it + Math.random())*sampler.dt
  out.cell = lo
}

// ---------------------------------------------------------------------------
// Output packing
// ---------------------------------------------------------------------------

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0])*t
  out[1] = a[1] + (b[1] - a[1])*t
  out[2] = a[2] + (b[2] - a[2])*t
}

/**
 * Colour × brightness → three bytes over [0, COLOR_RANGE]; size → one byte
 * over [0, SIZE_RANGE]. Four bytes per star instead of sixteen: a quarter of
 * the upload and a quarter of the vertex fetch bandwidth.
 */
function packStar(colors, sizes, i, color, brightness, size) {
  colors[i*3 + 0] = clamp(color[0]*brightness/COLOR_RANGE*255 + 0.5, 0, 255)
  colors[i*3 + 1] = clamp(color[1]*brightness/COLOR_RANGE*255 + 0.5, 0, 255)
  colors[i*3 + 2] = clamp(color[2]*brightness/COLOR_RANGE*255 + 0.5, 0, 255)

  sizes[i] = clamp(size/SIZE_RANGE*255 + 0.5, 0, 255)
}

// ---------------------------------------------------------------------------
// The generators
// ---------------------------------------------------------------------------

/**
 * The luminous half of the galaxy, as flat arrays.
 *
 * `structural` reroutes the unresolvable populations (nucleus sprites, haze,
 * off-plane halo) back into disc grain and skips the grid entirely — morph
 * targets need a few thousand plausible positions, not the texture.
 *
 * `grid` is a `buildGalaxyGrid(radius)` result; built here if not supplied.
 */
export function spiralGalaxy(count, radius, { structural = false, grid = null } = {}) {
  const positions = new Float32Array(count*3)
  const colors = new Uint8Array(count*3)
  const sizes = new Uint8Array(count)

  if (!structural && !grid) grid = buildGalaxyGrid(radius)

  const cos = Math.cos(GALAXY_TILT)
  const sin = Math.sin(GALAXY_TILT)

  const cosB = Math.cos(BAR_ANGLE)
  const sinB = Math.sin(BAR_ANGLE)

  // Population budget. Haze at 7%: half of what it was, at 1.5x the alpha —
  // it is a smooth layer, and the same light from half the sprites is half
  // the fill cost.
  const nNucleus = structural ? 0 : Math.min(420, Math.floor(count*0.002))
  const nBulge = Math.floor(count*0.028)
  const nBar = Math.floor(count*0.14)
  const nRidge = Math.floor(count*0.13)
  const nHII = Math.floor(count*0.010)
  const nHaze = structural ? 0 : Math.floor(count*0.07)
  const nHalo = structural ? 0 : Math.floor(count*0.012)

  const color = [0, 0, 0]
  const cell = { r: 0, theta: 0, cell: 0 }

  // Cell samplers for the two grid-driven populations. Weights are exactly
  // the old acceptance probabilities, so the statistics are unchanged.
  const grainSampler = structural ? null : buildCellSampler(grid, (ir, it, r) => {
    const o = (ir*GRID_NT + it)*4
    const density = grid.data[o]
    const tau = grid.data[o + 3]

    return density*grainProfile(r, radius)*(1 - 0.5*smoothstep(tau, 0.3, 1.3))
  })

  const hazeSampler = structural ? null : buildCellSampler(grid, (ir, it, r) => {
    const density = grid.data[(ir*GRID_NT + it)*4 + 1]

    return density*Math.sqrt(discProfile(r, radius, SCALE_LENGTH*1.18))*(0.35 + 0.65*smoothstep(r, radius*0.12, radius*0.34))
  })

  let i = 0

  while (i < count) {
    const k = i

    let x = 0
    let y = 0
    let z = 0
    let brightness = 0
    let size = 1

    if (k < nNucleus) {
      // The central blaze: few, wide, dim sprites stacking into a white core.
      const r = radius*0.07*Math.pow(Math.random(), 0.6)
      const theta = Math.random()*Math.PI*2

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r
      y = gaussian()*radius*0.012

      lerp3(color, COLOR_NUCLEUS, COLOR_NUCLEUS, 0)
      brightness = 0.005 + 0.005*Math.random()
      size = 12 + Math.random()*16
    } else if (k < nNucleus + nBulge) {
      // Sérsic-ish spheroid via rejection against exp(-b (r/Re)^0.55).
      let r = 0

      for (let attempt = 0; attempt < 20; attempt++) {
        r = radius*0.42*Math.sqrt(Math.random())

        if (Math.random() < Math.exp(-3.1*Math.pow(r/(BULGE_RE*radius), 0.55))) break
      }

      const theta = Math.random()*Math.PI*2
      const phi = Math.acos(Math.random()*2 - 1)

      x = Math.sin(phi)*Math.cos(theta)*r
      z = Math.sin(phi)*Math.sin(theta)*r
      y = Math.cos(phi)*r*0.55

      lerp3(color, COLOR_BULGE, COLOR_NUCLEUS, Math.exp(-r/(0.06*radius)))
      lerp3(color, color, COLOR_INNER, Math.random()*0.2)

      brightness = 0.04 + 0.05*Math.random()
      size = 0.30 + Math.pow(Math.random(), 3.4)*1.5
    } else if (k < nNucleus + nBulge + nBar) {
      // Ferrers bar: density (1 - (a/A)²)², elliptical cross-section that
      // shrinks towards the tips, faint ansae right at the ends.
      let along = 0

      for (let attempt = 0; attempt < 20; attempt++) {
        along = Math.random()*2 - 1

        if (Math.random() < Math.pow(1 - along*along, 2)) break
      }

      const cross = Math.sqrt(Math.max(0.08, 1 - along*along))

      const a = along*BAR_A*radius
      const b = gaussian()*BAR_B*radius*cross
      const h = gaussian()*BAR_C*radius*cross

      x = a*cosB - b*sinB
      z = a*sinB + b*cosB
      y = h

      lerp3(color, COLOR_BAR, COLOR_NUCLEUS, Math.exp(-Math.hypot(a, b*2.4)/(0.10*radius)))

      const ansae = 0.5*Math.exp(-Math.pow((Math.abs(along) - 0.90)/0.07, 2))

      brightness = (0.075 + 0.10*Math.random())*(1 + ansae)
      size = 0.30 + Math.pow(Math.random(), 3.2)*1.6

      // A share of wide sprites gives the bar its unresolved glow.
      if (!structural && Math.random() < 0.24) {
        brightness = 0.020 + 0.020*Math.random()
        size = 6 + Math.random()*10
      }
    } else if (k < nNucleus + nBulge + nBar + nRidge) {
      // Directly-sampled arm ridges: the crisp bright strands. Rejection
      // sampling smooths these away; placing stars *on* the ridge keeps them.
      const armIndex = Math.floor(Math.random()*ARMS.length)
      const arm = ARMS[armIndex]

      const r = (arm.from + (arm.to - arm.from)*Math.random())*radius
      const span = armSpan(arm, r, radius)

      if (Math.random() > span*arm.weight*smoothstep(r, arm.from*radius, (arm.from + 0.28)*radius)) continue

      const sigma = armSigma(arm, r, radius)
      const ridge = armTheta(arm, r, radius)
      const u = gaussian()*sigma*0.65
      const theta = ridge + u
      const w = ridge - BAR_ANGLE - arm.phase

      const strand = ridged(u*8.0 + armIndex*41.7, w*5.2, 3)

      if (Math.random() > 0.15 + strand) continue

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r
      y = gaussian()*radius*(0.010 + 0.030*Math.exp(-r/(0.2*radius)))

      const t = r/radius

      lerp3(color, COLOR_ARM, COLOR_STAR, strand*0.30)
      lerp3(color, color, COLOR_INNER, Math.max(0, 1 - t/0.45)*0.5)

      brightness = (0.16 + 0.26*Math.random())*Math.pow(discProfile(r, radius), 0.35)*(0.6 + strand)
      size = 0.25 + Math.pow(Math.random(), 3.8)*1.6
    } else if (k < nNucleus + nBulge + nBar + nRidge + nHII) {
      // HII regions: pink knots chained along the ridges of the stronger arms.
      const armIndex = Math.floor(Math.random()*4)
      const arm = ARMS[armIndex]

      const r = (arm.from + (arm.to - arm.from)*(0.10 + 0.78*Math.random()))*radius
      const ridge = armTheta(arm, r, radius)
      const w = ridge - BAR_ANGLE - arm.phase

      // Chains: only where this noise crests do knots exist at all.
      if (fbm(w*4.5 + armIndex*17.9, 0.31, 3) < 0.64) continue
      if (Math.random() > armSpan(arm, r, radius)) continue

      const sigma = armSigma(arm, r, radius)
      const theta = ridge + gaussian()*sigma*0.7

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r
      y = gaussian()*radius*0.008

      lerp3(color, COLOR_HII, COLOR_HII_BRIGHT, Math.random()*0.6)
      brightness = 0.22 + 0.35*Math.random()
      size = 1.6 + Math.pow(Math.random(), 1.6)*3.2
    } else if (k < nNucleus + nBulge + nBar + nRidge + nHII + nHaze) {
      // Unresolved light: wide, dim, and following the same structure at low
      // contrast. This fills the space between the grain without owning it.
      sampleCell(hazeSampler, cell)

      const r = cell.r
      const theta = cell.theta

      if (r > radius*1.25) continue

      const profile = Math.sqrt(discProfile(r, radius, SCALE_LENGTH*1.18))*(0.35 + 0.65*smoothstep(r, radius*0.12, radius*0.34))

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r
      y = gaussian()*radius*(0.018 + 0.055*Math.exp(-r/(0.18*radius)))

      const t = r/radius
      const tau = sampleGrid(grid, r, theta, 3)

      lerp3(color, COLOR_INNER, COLOR_ARM, smoothstep(t, 0.20, 0.60))
      lerp3(color, color, COLOR_RIM, smoothstep(t, 0.62, 1.1)*0.6)

      brightness = 1.5*(0.16 + 0.14*Math.random())*profile*(1 - 0.35*smoothstep(tau, 0.2, 1.2))
      size = 4.5 + Math.random()*8
    } else if (!structural && k < count - nHalo) {
      brightness = -1 // routed below: plain disc grain
    } else if (structural) {
      brightness = -1
    } else {
      // Off-plane halo: sparse faint stars in a thick oblate volume. They are
      // what gives the tilted disc, and the flight into it, a third dimension.
      const theta = Math.random()*Math.PI*2
      const rho = radius*1.05*Math.sqrt(Math.random())

      x = Math.cos(theta)*rho
      z = Math.sin(theta)*rho
      y = gaussian()*radius*(0.05 + 0.16*Math.exp(-rho/(0.5*radius)))

      if (Math.abs(y) < radius*0.02) continue // the plane is already busy

      lerp3(color, COLOR_RIM, COLOR_STAR, Math.random()*0.5)
      brightness = (0.05 + 0.07*Math.random())*Math.exp(-rho/(0.6*radius))
      size = 0.25 + Math.pow(Math.random(), 3.0)*1.1
    }

    // Disc grain: the bulk population. Uniform over area, rejected against the
    // full density field, brightness carrying the exponential profile. This is
    // the sandpaper the whole image is made of.
    if (brightness === -1) {
      let r
      let theta
      let density
      let arms

      if (structural) {
        // No grid for the morph target: a smooth arm bias is plenty, and
        // rejection is fine at this count.
        r = radius*1.16*Math.sqrt(Math.random())
        theta = Math.random()*Math.PI*2
        density = INTERARM + plainArms(r, theta, radius)
        arms = density - INTERARM

        if (Math.random()*2.4 > density*grainProfile(r, radius)) continue
      } else {
        // The sampler already weighs by density × profile × dust carve-out.
        sampleCell(grainSampler, cell)

        r = cell.r
        theta = cell.theta

        if (r > radius*1.16) continue

        density = sampleGrid(grid, r, theta, 0)
        arms = sampleGrid(grid, r, theta, 2)
      }

      const profile = grainProfile(r, radius)

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r
      y = gaussian()*radius*(0.009 + 0.040*Math.exp(-r/(0.16*radius)))

      const t = r/radius
      const armness = clamp(arms/(density + 1e-5), 0, 1)

      lerp3(color, COLOR_INNER, COLOR_ARM, smoothstep(t, 0.30, 0.66)*(0.5 + 0.5*armness))
      lerp3(color, color, COLOR_RIM, smoothstep(t, 0.60, 1.05)*0.55)

      brightness = (0.30 + 0.50*Math.random())*Math.pow(profile, 0.7)*(0.45 + 0.30*Math.min(2.6, density))

      size = 0.34 + Math.pow(Math.random(), 4.2)*1.5

      // A sprinkling of resolved bright stars — near-white, a little larger.
      // These are what read as "photograph" at full zoom.
      if (Math.random() < 0.016) {
        lerp3(color, COLOR_STAR, COLOR_STAR, 0)
        brightness = 0.5 + 0.6*Math.random()
        size = 1.6 + Math.pow(Math.random(), 2.0)*2.2
      }
    }

    positions[i*3 + 0] = x
    positions[i*3 + 1] = y*cos - z*sin
    positions[i*3 + 2] = y*sin + z*cos

    packStar(colors, sizes, i, color, brightness, size)

    i++
  }

  return { positions, colors, sizes }
}

/**
 * Noise-free arm bias, for the structural (morph target) build only.
 */
function plainArms(r, theta, radius) {
  let sum = 0

  for (let i = 0; i < ARMS.length; i++) {
    const arm = ARMS[i]
    const span = armSpan(arm, r, radius)

    if (span < 0.01) continue

    const t = wrapPi(theta - armTheta(arm, r, radius))/armSigma(arm, r, radius)

    if (Math.abs(t) > 3.2) continue

    sum += arm.weight*span*Math.exp(-0.5*t*t)
  }

  return sum
}

/**
 * The absorbing half. Each point's `aOpacity` is its optical depth share; the
 * shader turns that into per-channel transmission, so thin dust reddens and
 * only thick dust darkens. `aColor.r` carries per-point variation.
 */
export function galaxyDust(count, radius, { grid = null } = {}) {
  const positions = new Float32Array(count*3)
  const variation = new Uint8Array(count)
  const sizes = new Uint8Array(count)
  const opacities = new Uint8Array(count)

  if (!grid) grid = buildGalaxyGrid(radius)

  const cos = Math.cos(GALAXY_TILT)
  const sin = Math.sin(GALAXY_TILT)

  const sampler = buildCellSampler(grid, (ir, it, r) => r > radius*1.02 ? 0 : grid.data[(ir*GRID_NT + it)*4 + 3])
  const cell = { r: 0, theta: 0, cell: 0 }

  let i = 0

  while (i < count) {
    sampleCell(sampler, cell)

    const r = cell.r
    const theta = cell.theta
    const tau = sampleGrid(grid, r, theta, 3)

    if (tau <= 0) continue

    const x = Math.cos(theta)*r
    const z = Math.sin(theta)*r

    // Dust settles into a thinner layer than the stars.
    const y = gaussian()*radius*(0.0025 + 0.012*Math.exp(-r/(0.18*radius)))

    positions[i*3 + 0] = x
    positions[i*3 + 1] = y*cos - z*sin
    positions[i*3 + 2] = y*sin + z*cos

    variation[i] = 178 + Math.random()*77
    opacities[i] = clamp(tau*(0.16 + 0.22*Math.random()), 0, 1)*255
    sizes[i] = clamp((1.4 + Math.pow(Math.random(), 1.4)*3.6)/SIZE_RANGE*255 + 0.5, 0, 255)

    i++
  }

  return { positions, variation, sizes, opacities }
}

/**
 * Both halves at once, sharing one grid. This is what the worker runs.
 */
export function generateGalaxy(count, dustCount, radius) {
  const t0 = now()
  const grid = buildGalaxyGrid(radius)
  const tGrid = now()

  const field = spiralGalaxy(count, radius, { grid })
  const tField = now()

  const dust = galaxyDust(dustCount, radius, { grid })
  const tDust = now()

  return {
    field,
    dust,
    timing: { grid: tGrid - t0, field: tField - tGrid, dust: tDust - tField }
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
