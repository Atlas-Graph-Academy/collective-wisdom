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

import { spiralGalaxy, GALAXY_TILT } from './galaxy'

export { GALAXY_TILT }

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

/**
 * A cheap, smooth, deterministic scalar field in [0, 1]. Three sines beating
 * against each other at incommensurate frequencies — enough low-frequency
 * structure to sculpt lobes out of a sphere without shipping a noise library.
 */
function lobeField(d) {
  const n =
    Math.sin(d.x*3.1 + d.y*1.7)
    + Math.sin(d.y*2.7 - d.z*2.3 + 1.3)
    + Math.sin(d.z*3.4 + d.x*1.1 - 0.7)
    + 0.5*Math.sin(d.x*6.2 - d.y*5.1 + d.z*4.3)

  return MathUtils.clamp(n/3.5*0.5 + 0.5, 0, 1)
}

/**
 * The organism: a single cell-like body, in the spirit of Andy Lomas's growth
 * forms — a sphere pushed into lobes by a smooth field, a few buds pinched off
 * it, and a thin filling so it reads as a body rather than a shell. Roughly
 * the brain's size, so the step from it to the brain is a change of form, not
 * of scale.
 */
export function organismPoints(count, radius) {
  const points = []
  const dirs = fibonacciSphere(count, 1)

  const buds = [
    { c: new Vector3(0.62, 0.38, 0.12), r: 0.42 },
    { c: new Vector3(-0.55, -0.22, 0.4), r: 0.36 },
    { c: new Vector3(0.1, -0.6, -0.42), r: 0.34 },
    { c: new Vector3(-0.3, 0.55, -0.45), r: 0.3 }
  ]

  for (let i = 0; i < count; i++) {
    const d = dirs[i]
    const lobe = lobeField(d)

    // Body radius in this direction: a lobed sphere.
    let r = 0.58 + 0.34*lobe

    // Buds: where the direction points into a bud, the surface bulges out to it.
    buds.forEach(bud => {
      const along = d.dot(bud.c.clone().normalize())
      const reach = bud.c.length() + bud.r
      const w = MathUtils.smoothstep(along, 0.55, 1)

      r = Math.max(r, MathUtils.lerp(r, reach*(0.8 + 0.2*lobe), w))
    })

    // Most points on the skin, the rest inside — a body, not a balloon.
    const inside = (i%5 === 0) ? Math.cbrt(Math.random())*0.85 : MathUtils.randFloat(0.94, 1.02)

    points.push(d.clone().multiplyScalar(r*inside*radius))
  }

  return points
}

/**
 * The same galaxy, as `Vector3`s, for the handful of instances that morph into
 * it. They overlay the dense field exactly because both come from one generator.
 */
export function galaxyPoints(count, radius) {
  const { positions } = spiralGalaxy(count, radius, { structural: true })
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
 * The sky. Two facts carry the look of a real starfield and neither is
 * "scatter white dots":
 *
 *  - Brightness follows a power law. Each magnitude fainter there are ~2.5x
 *    more stars, so almost everything is at the threshold of visibility and
 *    a handful of stars dominate. A field where every star is roughly the
 *    same size reads as confetti.
 *  - Stars have colour, and the mix is skewed. Bright naked-eye stars are
 *    mostly white-blue (A/B), the yellow/orange (G/K) ones are commoner but
 *    fainter, and the reds are rare at any brightness you can see.
 *
 * `positions` sit on a shell far outside the scene; `colors` carry
 * brightness pre-multiplied; `sizes` are in CSS px; `kinds` flag the few
 * background galaxies (1) among the stars (0) so the shader can give them a
 * fuzzy profile instead of a stellar one.
 */
const STAR_TYPES = [
  // colour,   weight, brightness bias
  [0x9BB4FF,   0.06,   1.35],   // B  — blue-white, rare, bright
  [0xC9D6FF,   0.14,   1.20],   // A
  [0xF3F2FF,   0.16,   1.05],   // F
  [0xFFF4E4,   0.24,   0.95],   // G  — solar
  [0xFFD9B0,   0.28,   0.85],   // K
  [0xFFB884,   0.12,   0.70]    // M  — orange-red, faint
]

const GALAXY_TYPES = [
  0xF7EBD8, // old elliptical, warm
  0xE8ECFF, // spiral seen far off, cool
  0xFFE7CF
]

export function skyPoints(count, radius, galaxyCount = 0) {
  const total = count + galaxyCount

  const positions = new Float32Array(total*3)
  const colors = new Float32Array(total*3)
  const sizes = new Float32Array(total)
  const phases = new Float32Array(total)
  const kinds = new Float32Array(total)

  const color = new Color()

  const totalWeight = STAR_TYPES.reduce((sum, t) => sum + t[1], 0)

  for (let i = 0; i < total; i++) {
    const theta = MathUtils.randFloat(0, Math.PI*2)
    const phi = Math.acos(MathUtils.randFloat(-1, 1))
    const r = radius*MathUtils.randFloat(0.85, 1.15)

    positions[i*3 + 0] = Math.sin(phi)*Math.cos(theta)*r
    positions[i*3 + 1] = Math.cos(phi)*r
    positions[i*3 + 2] = Math.sin(phi)*Math.sin(theta)*r

    phases[i] = Math.random()

    if (i < count) {
      // Spectral type by weight.
      let pick = Math.random()*totalWeight
      let type = STAR_TYPES[STAR_TYPES.length - 1]

      for (let t = 0; t < STAR_TYPES.length; t++) {
        pick -= STAR_TYPES[t][1]

        if (pick <= 0) { type = STAR_TYPES[t]; break }
      }

      // Magnitude distribution: a steep power law, so most stars sit near the
      // floor and a few percent stand out.
      const u = Math.random()
      const luminosity = Math.pow(u, 4.0)*type[2]

      color.setHex(type[0])

      // Very bright stars wash towards white — the eye (and the sensor)
      // saturate.
      color.lerp(new Color(0xFFFFFF), MathUtils.smoothstep(luminosity, 0.5, 1.2)*0.5)

      const brightness = 0.36 + 1.4*luminosity

      colors[i*3 + 0] = color.r*brightness
      colors[i*3 + 1] = color.g*brightness
      colors[i*3 + 2] = color.b*brightness

      // Size tracks brightness only weakly — a bright star is a bigger blur,
      // not a bigger disc.
      sizes[i] = 0.9 + 3.2*Math.pow(luminosity, 0.6)
      kinds[i] = 0
    } else {
      // Background galaxies: faint, fuzzy, a few px across.
      color.setHex(GALAXY_TYPES[MathUtils.randInt(0, GALAXY_TYPES.length - 1)])

      const brightness = 0.14 + 0.16*Math.random()

      colors[i*3 + 0] = color.r*brightness
      colors[i*3 + 1] = color.g*brightness
      colors[i*3 + 2] = color.b*brightness

      sizes[i] = 3.5 + Math.random()*5.5
      kinds[i] = 1
    }
  }

  return { positions, colors, sizes, phases, kinds }
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
