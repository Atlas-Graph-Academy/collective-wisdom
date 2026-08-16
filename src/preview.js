/**
 * Dev-only harness for tuning the galaxy field. Renders the field on its own —
 * no model load, no scroll timeline — so a headless screenshot lands on the
 * exact frame being tuned. Not part of the site build.
 *
 *   ?tilt=0     face-on (matches the NASA reference plate)
 *   ?tilt=site  the tilt the page actually ships
 *   ?dist=2.4   camera distance in galaxy radii
 */

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  AdditiveBlending,
  MultiplyBlending,
  Vector2,
  Vector3
} from 'three'

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

import { skyPoints } from './shapes'
import { generateGalaxy, GALAXY_TILT, GALAXY_NORMAL, COLOR_RANGE, SIZE_RANGE } from './galaxy'

const params = new URLSearchParams(window.location.search)
const tiltMode = params.get('tilt') || '0'
const distance = parseFloat(params.get('dist') || '3.0')
const count = parseInt(params.get('count') || '90000', 10)
const fov = parseFloat(params.get('fov') || '45')
const worldScale = parseFloat(params.get('scale') || '1')

const RADIUS = 1

const scene = new Scene()

const camera = new PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.01, 100)

const renderer = new WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x000000, 1)
document.body.appendChild(renderer.domElement)

const dustCount = parseInt(params.get('dust') || String(Math.round(count*0.2)), 10)
const tGen = performance.now()
const { field, dust: dustField, timing } = generateGalaxy(count, dustCount, RADIUS)
console.log('generate ms', (performance.now() - tGen).toFixed(0), timing)
const normal = new Vector3().fromArray(GALAXY_NORMAL)

const geometry = new BufferGeometry()
geometry.setAttribute('position', new BufferAttribute(field.positions, 3))
geometry.setAttribute('aColor', new BufferAttribute(field.colors, 3, true))
geometry.setAttribute('aSize', new BufferAttribute(field.sizes, 1, true))

const material = new ShaderMaterial({
  vertexShader: require('./shaders/galaxy.vertex.glsl'),
  fragmentShader: require('./shaders/galaxy.fragment.glsl'),
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uScale: { value: 1 },
    uMaxSize: { value: 22 },
    uNormal: { value: normal },
    uColorRange: { value: COLOR_RANGE },
    uSizeRange: { value: SIZE_RANGE },
    uOpacity: { value: 0.9 }
  }
})

const points = new Points(geometry, material)

points.frustumCulled = false
points.renderOrder = 0

const dustGeometry = new BufferGeometry()
dustGeometry.setAttribute('position', new BufferAttribute(dustField.positions, 3))
dustGeometry.setAttribute('aVariation', new BufferAttribute(dustField.variation, 1, true))
dustGeometry.setAttribute('aSize', new BufferAttribute(dustField.sizes, 1, true))
dustGeometry.setAttribute('aOpacity', new BufferAttribute(dustField.opacities, 1, true))

const dust = new Points(dustGeometry, new ShaderMaterial({
  vertexShader: require('./shaders/dust.vertex.glsl'),
  fragmentShader: require('./shaders/dust.fragment.glsl'),
  transparent: true,
  depthWrite: false,
  blending: MultiplyBlending,
  uniforms: {
    uPixelRatio: { value: renderer.getPixelRatio() },
    uScale: { value: 1 },
    uMaxSize: { value: 33 },
    uNormal: { value: normal },
    uSizeRange: { value: SIZE_RANGE },
    uOpacity: { value: 1 }
  }
}))

dust.frustumCulled = false
dust.renderOrder = 1

// The generator bakes the page's tilt into the positions. Undo it here so the
// preview can look straight down at the disc.
if (tiltMode === '0') {
  points.rotation.x = -GALAXY_TILT
  dust.rotation.x = -GALAXY_TILT
}

points.scale.setScalar(worldScale)
dust.scale.setScalar(worldScale)

scene.add(points)
scene.add(dust)

// The sky, same generator and shaders as the site.
{
  const sky = skyPoints(9000, 16, 60)
  const g = new BufferGeometry()

  g.setAttribute('position', new BufferAttribute(sky.positions, 3))
  g.setAttribute('aColor', new BufferAttribute(sky.colors, 3))
  g.setAttribute('aSize', new BufferAttribute(sky.sizes, 1))
  g.setAttribute('aPhase', new BufferAttribute(sky.phases, 1))
  g.setAttribute('aKind', new BufferAttribute(sky.kinds, 1))

  const stars = new Points(g, new ShaderMaterial({
    vertexShader: require('./shaders/star.vertex.glsl'),
    fragmentShader: require('./shaders/star.fragment.glsl'),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uPixelRatio: { value: renderer.getPixelRatio() }
    }
  }))

  stars.frustumCulled = false
  scene.add(stars)
}

if (tiltMode === '0') {
  camera.position.set(0, distance*RADIUS, 0.0001)
} else {
  camera.position.set(0, 0, distance*RADIUS)
}

camera.lookAt(0, 0, 0)

const composer = new EffectComposer(renderer)

composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight),
  parseFloat(params.get('bloom') || '0.62'),
  0.4,
  parseFloat(params.get('threshold') || '0.2')
))

composer.render()

// A couple of extra frames, so a screenshot taken slightly late still lands on
// a fully composited image.
let frames = 0

renderer.setAnimationLoop(() => {
  composer.render()

  if (++frames > 4) renderer.setAnimationLoop(null)
})

window.__galaxyPoints = field.positions.length / 3

console.log('galaxy preview:', window.__galaxyPoints, 'points')
