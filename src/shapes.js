import {
  LatheGeometry,
  SphereGeometry,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Color,
  Vector2,
  Vector3,
  MathUtils
} from 'three'

import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler'

/**
 * Every morph target has to expose exactly the same number of points as the
 * brain model, because the morph is a per-instance `mix()` between two of these
 * arrays. None of these need an authored asset — they're generated at runtime.
 */

/**
 * Silhouette of a lightbulb, as (radius, height) pairs revolved around Y.
 * Roughly unit-height so it can be rescaled to match the brain.
 */
const BULB_PROFILE = [
  [0.00, -0.50],
  [0.12, -0.50],
  [0.13, -0.43],
  [0.12, -0.36],
  [0.13, -0.31],
  [0.12, -0.26],
  [0.10, -0.21],
  [0.09, -0.15],
  [0.12, -0.07],
  [0.18,  0.01],
  [0.24,  0.09],
  [0.27,  0.17],
  [0.28,  0.25],
  [0.26,  0.33],
  [0.20,  0.41],
  [0.11,  0.47],
  [0.00,  0.49]
]

export function createBulbMesh() {
  const profile = BULB_PROFILE.map(([x, y]) => new Vector2(x, y))
  const geometry = new LatheGeometry(profile, 64)

  return new Mesh(geometry, new MeshBasicMaterial({ visible: false }))
}

export function createSphereMesh() {
  return new Mesh(new SphereGeometry(0.5, 48, 32), new MeshBasicMaterial({ visible: false }))
}

/**
 * Even coverage of a mesh's surface. Used for the shapes whose silhouette is
 * what matters (the bulb), where a vertex dump would clump at the poles.
 */
export function samplePointsOnMesh(mesh, count) {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const sampler = new MeshSurfaceSampler(new Mesh(geometry, mesh.material)).build()

  const points = []
  const point = new Vector3()

  for (let i = 0; i < count; i++) {
    sampler.sample(point)
    points.push(point.clone())
  }

  return points
}

/**
 * Fibonacci sphere — noticeably more uniform than random surface sampling, which
 * is what the reference's globe state looks like.
 */
export function fibonacciSphere(count, radius) {
  const points = []
  const increment = Math.PI*(3 - Math.sqrt(5))

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1))*2
    const r = Math.sqrt(Math.max(0, 1 - y*y))
    const theta = increment*i

    points.push(new Vector3(Math.cos(theta)*r*radius, y*radius, Math.sin(theta)*r*radius))
  }

  return points
}

/**
 * The loose field the reference falls back to behind its text-heavy sections.
 * Biased outwards so the middle doesn't read as a solid mass.
 */
export function cloudPoints(count, radius) {
  const points = []

  for (let i = 0; i < count; i++) {
    const theta = MathUtils.randFloat(0, Math.PI*2)
    const phi = Math.acos(MathUtils.randFloat(-1, 1))
    const r = radius*(0.45 + 0.55*Math.cbrt(Math.random()))*MathUtils.randFloat(0.85, 1.6)

    points.push(new Vector3(
      Math.sin(phi)*Math.cos(theta)*r*1.5,
      Math.cos(phi)*r*0.85,
      Math.sin(phi)*Math.sin(theta)*r
    ))
  }

  return points
}

// The disc is generated flat in XZ and then pitched towards the camera by this
// much. Without it a disc in the camera's line of sight is just a bright line.
export const GALAXY_TILT = -1.12

// Two major arms, like the Milky Way's Perseus and Scutum-Centaurus. Four crisp
// arms is what makes a spiral read as a pinwheel graphic instead of a galaxy.
const GALAXY_ARMS = 2

// Pitch angle of the logarithmic spiral, in radians (~17deg). Real Sb spirals
// sit around 10-20deg; this is what sets how tightly the arms wind.
const GALAXY_PITCH = 0.3

// Where the arms start, as a fraction of the radius.
const GALAXY_INNER = 0.085

// Exponential disc scale length. Surface density falls as exp(-r/h), which is
// the single biggest reason a real galaxy looks continuous rather than drawn.
const GALAXY_SCALE_LENGTH = 0.36

const GALAXY_BULGE_SHARE = 0.17

// Points placed with no arm bias at all. Real discs are lit between the arms
// too — leaving that gap empty is what makes arms look like ribbons.
const GALAXY_SMOOTH_SHARE = 0.26

const GALAXY_COLOR_CORE = new Color(0xFFC97A)
const GALAXY_COLOR_MID = new Color(0xFFEBC8)
const GALAXY_COLOR_ARM = new Color(0x9FBEFF)
const GALAXY_COLOR_HII = new Color(0xFF6E9F)

function gaussian() {
  let u = 0
  let v = 0

  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()

  return Math.sqrt(-2*Math.log(u))*Math.cos(Math.PI*2*v)
}

/**
 * A spiral galaxy built the way one actually looks rather than the way one is
 * usually drawn. The differences that matter:
 *
 * - Radius is drawn from an exponential disc, so density falls off smoothly
 *   instead of every point sitting on a ribbon.
 * - Arms are a *bias* applied to the azimuth of disc stars, not a set of
 *   curves that points are placed along, and a quarter of the disc ignores the
 *   bias entirely so the inter-arm regions still glow.
 * - The spiral is logarithmic (theta = ln(r/r0)/tan(pitch)) rather than a fixed
 *   twist per unit radius, which is why the arms keep winding at the rim.
 * - A dust lane runs along the inner edge of each arm.
 * - Colour follows stellar population: an old, metal-rich yellow bulge, bluer
 *   star-forming arms, and pink HII knots.
 *
 * Returns flat arrays so the same generator can fill a 90k-point field without
 * allocating an object per star.
 */
export function spiralGalaxy(count, radius) {
  const positions = new Float32Array(count*3)
  const colors = new Float32Array(count*3)
  const sizes = new Float32Array(count)

  const cos = Math.cos(GALAXY_TILT)
  const sin = Math.sin(GALAXY_TILT)

  const inner = radius*GALAXY_INNER
  const scaleLength = radius*GALAXY_SCALE_LENGTH
  const bulgeCount = Math.floor(count*GALAXY_BULGE_SHARE)

  const color = new Color()

  let i = 0

  while (i < count) {
    let x
    let y
    let z
    let brightness = 1
    let size

    if (i < bulgeCount) {
      // Old, dense, slightly flattened spheroid.
      const r = radius*0.17*Math.pow(Math.random(), 0.62)
      const theta = MathUtils.randFloat(0, Math.PI*2)
      const phi = Math.acos(MathUtils.randFloat(-1, 1))

      x = Math.sin(phi)*Math.cos(theta)*r
      z = Math.sin(phi)*Math.sin(theta)*r
      y = Math.cos(phi)*r*0.6

      color.copy(GALAXY_COLOR_CORE).lerp(GALAXY_COLOR_MID, Math.random()*0.5)
      brightness = 0.75 + Math.random()*0.5
      size = Math.pow(Math.random(), 2.4)*2 + 0.5
    } else {
      // Exponential disc: r = -h*ln(1 - u).
      const r = -scaleLength*Math.log(1 - Math.random())

      if (r < inner || r > radius*1.08) continue

      const t = r / radius
      const smooth = Math.random() < GALAXY_SMOOTH_SHARE

      let theta

      if (smooth) {
        theta = MathUtils.randFloat(0, Math.PI*2)
      } else {
        // Arms are tightly wound near the hub, so their angular width has to be
        // wider there to cover the same physical spread.
        const spread = 0.16 + 0.4*Math.exp(-r / (0.3*radius))
        const offset = gaussian()*spread

        // Dust lane: a deficit of stars just inside the arm ridge.
        if (Math.abs(offset + spread*1.15) < spread*0.34 && Math.random() < 0.82) continue

        const arm = MathUtils.randInt(0, GALAXY_ARMS - 1)

        theta = (arm / GALAXY_ARMS)*Math.PI*2 + Math.log(r / inner) / Math.tan(GALAXY_PITCH) + offset
      }

      x = Math.cos(theta)*r
      z = Math.sin(theta)*r

      // Thin disc that puffs up towards the hub.
      y = gaussian()*radius*(0.011 + 0.055*Math.exp(-r / (0.14*radius)))

      color.copy(GALAXY_COLOR_MID).lerp(GALAXY_COLOR_ARM, MathUtils.smoothstep(t, 0.06, 0.5))

      if (r < radius*0.3) {
        color.lerp(GALAXY_COLOR_CORE, MathUtils.smoothstep(t, 0.3, 0.05)*0.7)
      }

      brightness = 0.45 + Math.random()*0.55
      size = Math.pow(Math.random(), 2.6)*1.9 + 0.4

      // Star-forming regions, only out in the arms where they belong.
      if (!smooth && r > radius*0.2 && Math.random() < 0.045) {
        color.copy(GALAXY_COLOR_HII)
        brightness = 1.1 + Math.random()*0.5
        size *= 2.1
      }
    }

    positions[i*3 + 0] = x
    positions[i*3 + 1] = y*cos - z*sin
    positions[i*3 + 2] = y*sin + z*cos

    colors[i*3 + 0] = color.r*brightness
    colors[i*3 + 1] = color.g*brightness
    colors[i*3 + 2] = color.b*brightness

    sizes[i] = size

    i++
  }

  return { positions, colors, sizes }
}

/**
 * The same galaxy, as `Vector3`s, for the handful of instances that morph into
 * it. They overlay the dense field exactly because both come from one generator.
 */
export function galaxyPoints(count, radius) {
  const { positions } = spiralGalaxy(count, radius)
  const points = []

  for (let i = 0; i < count; i++) {
    points.push(new Vector3(positions[i*3], positions[i*3 + 1], positions[i*3 + 2]))
  }

  return points
}

/**
 * Flat stand-in for the galaxy so the hover ripple still has a surface to land
 * on. Matches the point cloud's pitch exactly.
 */
export function createGalaxyMesh() {
  const geometry = new CircleGeometry(1, 64)

  // CircleGeometry is built in XY; drop it into XZ, then apply the same pitch.
  geometry.rotateX(-Math.PI*0.5 + GALAXY_TILT)

  return new Mesh(geometry, new MeshBasicMaterial({ visible: false, side: DoubleSide }))
}

/**
 * Stars. Far enough out that the camera's parallax barely touches them, which
 * is exactly how a sky should behave.
 */
export function starPoints(count, radius) {
  const points = []

  for (let i = 0; i < count; i++) {
    const theta = MathUtils.randFloat(0, Math.PI*2)
    const phi = Math.acos(MathUtils.randFloat(-1, 1))
    const r = radius*MathUtils.randFloat(0.85, 1.15)

    points.push(new Vector3(
      Math.sin(phi)*Math.cos(theta)*r,
      Math.cos(phi)*r,
      Math.sin(phi)*Math.sin(theta)*r
    ))
  }

  return points
}

/**
 * Gives two point clouds a shared ordering so index `i` in one is a plausible
 * partner for index `i` in the other. Without this the morph is pure noise —
 * points cross the whole shape to reach an unrelated destination. Sorting by
 * latitude band first, then by azimuth, keeps the top of the brain travelling to
 * the top of the bulb.
 */
export function sortSpherically(points, bands = 28) {
  return points
    .map(p => {
      const r = p.length() || 1e-6
      const phi = Math.acos(MathUtils.clamp(p.y / r, -1, 1))

      return {
        p,
        band: Math.min(bands - 1, Math.floor(phi / Math.PI*bands)),
        theta: Math.atan2(p.z, p.x)
      }
    })
    .sort((a, b) => a.band - b.band || a.theta - b.theta)
    .map(entry => entry.p)
}

export function pointsToArray(points) {
  const array = new Float32Array(points.length*3)

  points.forEach((p, i) => {
    array[i*3 + 0] = p.x
    array[i*3 + 1] = p.y
    array[i*3 + 2] = p.z
  })

  return array
}
