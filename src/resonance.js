import { Vector3 } from 'three'

/**
 * The connections. Every point is wired to a couple of neighbours, and the
 * light that strikes the first grain travels along those wires — the wave
 * front is a breadth-first walk of this graph, so "hit one, it hits the next"
 * is literally what the activation times encode.
 *
 * Neighbours are chosen to be near in the dust, the organism *and* the brain:
 * the same lines have to read as sparks jumping between grains and, later, as
 * synapses inside the brain, without ever being rewired.
 */
export function buildResonanceGraph(dust, organism, brain, { perPoint = 2, candidates = 12, seed = null } = {}) {
  const n = dust.length

  // Normalise the two spaces so neither dominates the neighbour choice.
  const dustScale = 1/(radiusOf(dust) || 1)
  const organismScale = 1/(radiusOf(organism) || 1)
  const brainScale = 1/(radiusOf(brain) || 1)

  const edges = new Set()
  const adjacency = Array.from({ length: n }, () => [])
  const key = (a, b) => a < b ? a*n + b : b*n + a

  const scored = new Array(n)

  for (let i = 0; i < n; i++) {
    const di = dust[i]
    const oi = organism[i]
    const bi = brain[i]

    // Nearest few in the dust, by a plain scan. 2879² is a few million
    // subtractions — well under a frame's worth of work at load.
    const near = []

    for (let j = 0; j < n; j++) {
      if (j === i) continue

      const d2 = di.distanceToSquared(dust[j])

      if (near.length < candidates) {
        near.push({ j, d2 })
        if (near.length === candidates) near.sort((a, b) => a.d2 - b.d2)
        continue
      }

      if (d2 < near[candidates - 1].d2) {
        near[candidates - 1] = { j, d2 }
        near.sort((a, b) => a.d2 - b.d2)
      }
    }

    // Of those, keep the ones that are also close in the organism and the
    // brain — a line that is short in every shape never has to cross a body.
    near.forEach(entry => {
      entry.score =
        Math.sqrt(entry.d2)*dustScale
        + oi.distanceTo(organism[entry.j])*organismScale*1.4
        + bi.distanceTo(brain[entry.j])*brainScale*1.4
    })
    near.sort((a, b) => a.score - b.score)

    scored[i] = near.slice(0, perPoint).map(e => e.j)
  }

  for (let i = 0; i < n; i++) {
    scored[i].forEach(j => {
      const k = key(i, j)

      if (edges.has(k)) return

      edges.add(k)
      adjacency[i].push(j)
      adjacency[j].push(i)
    })
  }

  // The first grain to be struck. Default: whichever sits nearest a spot a
  // little in front of and above centre — where the eye rests.
  let origin = 0

  if (seed === null) {
    const target = new Vector3(0.12, 0.08, 0.35)
    let best = Infinity

    dust.forEach((p, i) => {
      const d = p.distanceToSquared(target)

      if (d < best) {
        best = d
        origin = i
      }
    })
  } else {
    origin = seed
  }

  // Breadth-first depth from the origin. Points the wave never reaches (small
  // islands) light up at the very end.
  const depth = new Int32Array(n).fill(-1)
  const queue = [origin]

  depth[origin] = 0

  let maxDepth = 0

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]

    adjacency[i].forEach(j => {
      if (depth[j] !== -1) return

      depth[j] = depth[i] + 1
      maxDepth = Math.max(maxDepth, depth[j])
      queue.push(j)
    })
  }

  const activation = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    // Everything is struck by 0.85 of the wave, so the last flashes have died
    // down by the time the wave is done — otherwise the grains struck last
    // would sit flaring for as long as the scroll parks there.
    if (depth[i] === -1) {
      activation[i] = 0.82 + Math.random()*0.03
      continue
    }

    // Slight jitter so the front is a ragged flame, not a set of rings.
    activation[i] = Math.min(0.85, (depth[i] + Math.random()*0.8)/(maxDepth + 1)*0.85)
  }

  const pairs = []

  edges.forEach(k => {
    const a = Math.floor(k/n)
    const b = k - a*n

    pairs.push([a, b])
  })

  return { pairs, activation, origin, maxDepth }
}

function radiusOf(points) {
  let r = 0

  points.forEach(p => {
    r = Math.max(r, p.length())
  })

  return r
}
