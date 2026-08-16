
import {
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
  TetrahedronGeometry,
  PlaneGeometry,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  Points,
  LineSegments,
  Group,
  ShaderMaterial,
  AdditiveBlending,
  MultiplyBlending,
  InstancedBufferAttribute,
  Color,
  Clock,
  Vector2,
  Vector3,
  Raycaster,
  Object3D,
  MathUtils,
  LoadingManager
} from 'three'

// Remove this if you don't need to load any 3D model
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh'

import Stats from 'stats.js'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { generateGalaxy, GALAXY_NORMAL, COLOR_RANGE, SIZE_RANGE } from './galaxy'

import {
  createSphereMesh,
  createGalaxyMesh,
  cloudPoints,
  organismPoints,
  galaxyPoints,
  skyPoints,
  sortSpherically,
  pointsToArray
} from './shapes'

import { buildResonanceGraph } from './resonance'

gsap.registerPlugin(ScrollTrigger)

const stats = new Stats()
document.body.appendChild(stats.dom)

const BACKGROUND_DISTANCE = 5

class App {
  constructor(container) {
    this.container = document.querySelector(container)

    this.hover = false

    this.colors = [
      new Color(0x963CBD),
      new Color(0xFF6F61),
      new Color(0xC5299B),
      new Color(0xFEAE51)
    ]

    this.uniforms = {
      uHover: 0
    }

    // The story, as one scalar the scroll timeline drives:
    // 0 = galaxy, 1 = dust, 2 = dust resonating, 3 = organism, 4 = brain.
    this.morph = { progress: 0 }

    // The rest of the story's state. `wave` is how far the light has travelled
    // through the dust (0..1).
    this.story = { wave: 0 }

    this.storyParams = {
      // World units of the incoherent shaking each grain does before the light
      // reaches it, and of the shared pulse it joins afterwards.
      jitter: 0.016,
      sync: 0.012,
      // Timeline units the wave takes to cross the field. Long: watching the
      // front crawl grain to grain is the point of the act.
      waveDuration: 3.5
    }

    // The background lifts through the story: dead black for the cosmos and
    // the dust, a first hint of colour as the light arrives, grey once there
    // is a body — the world becoming a place something can live in.
    this.backgroundStages = [
      { at: 0, inner: 0x0B0713, outer: 0x000000 },
      { at: 2, inner: 0x0B0713, outer: 0x000000 },
      { at: 3, inner: 0x161B2A, outer: 0x07090F },
      { at: 4, inner: 0x2A3040, outer: 0x161A24 }
    ]

    // Y rotation of the shape, from two independent sources that simply add:
    // `scroll` is animated by the timeline, `drag` is the user spinning it by
    // hand and keeps a little inertia after release.
    this.spin = { scroll: 0, drag: 0, idle: 0, velocity: 0 }

    // The "it's alive" layer. Small numbers on purpose: the shape should read as
    // breathing, not as wobbling.
    this.lifeParams = {
      // Flow-field drift, in world units. The brain's radius is ~0.5, and its
      // features are only a little larger than that, so this has to stay small
      // or the silhouette dissolves.
      flow: 0.007,
      // How much harder the field churns in the cloud state, which has no
      // silhouette to protect.
      cloudFlow: 4,
      // Fraction the whole shape swells and contracts by.
      breath: 0.022,
      // Fraction each instance's size flickers by, on its own phase.
      shimmer: 0.18,
      // Radians per second of rotation with no scroll and no drag at all.
      idleSpeed: 0.035
    }

    this.elapsed = 0

    this.pointer = {
      down: false,
      dragging: false,
      x: 0,
      y: 0,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0
    }

    this.scrollParams = {
      // Timeline units. The dwell is what stops a fast flick from blowing
      // through every state — scroll spends it spinning in place instead.
      hold: 2,
      morph: 1.5,
      holdSpin: 0.75,
      morphSpin: 0.4,
      // The flight into the galaxy gets a long run so it can accelerate.
      dive: 3,
      // Camera distance at the end of it. Close enough that the field has
      // stopped being a smear and is visibly separate points — that resolution
      // is what the whole flight is for, and it is also the handover: at this
      // range the dense field can go and the instances read as the same grains.
      diveDistance: 0.45,
      // Timeline units the arrival takes: the flight decelerating into the
      // cloud while the galaxy becomes the dust. Long enough to be a passage
      // rather than a swap.
      arrive: 1.8,
      // Where the flight comes to rest, and where the dust act is watched from.
      // Barely off `diveDistance` on purpose — see the note at the arrival.
      dustDistance: 0.7
    }

    this.dragParams = {
      // Radians per pixel of horizontal drag.
      sensitivity: 0.006,
      // Movement needed before a press counts as a drag rather than a click.
      threshold: 4,
      friction: 0.93,
      // Release velocity is capped because a single coarse pointermove — a
      // trackpad flick, or a synthetic event carrying hundreds of pixels at
      // once — would otherwise fling the shape through several full turns.
      // At this cap the glide settles within about 0.7rad.
      maxVelocity: 0.05,
      // How quickly the tracked velocity follows the latest movement.
      velocitySmoothing: 0.35
    }

    // Single source of truth for how far the camera sits from the origin.
    // `base` is what the scroll timeline animates; `scale` is the breakpoint
    // adjustment that used to be hardcoded into the render loop.
    this.cameraDistance = { base: 2.9, scale: 1 }

    // Mouse parallax. Kept off `camera.position` itself so the dive can
    // recompose the camera from scratch each frame without fighting a tween.
    this.parallax = { x: 0, y: 0 }

    // The flight into the galaxy. 0 = orbiting the origin as usual, 1 = the
    // camera has travelled all the way onto the point under the cursor.
    this.dive = { amount: 0 }

    // User zoom, on top of whatever distance the scroll timeline has chosen.
    // Kept in log2 space: every input (pinch ratio, wheel pixels, key press)
    // becomes an additive step, and equal steps feel equal at any magnification.
    // `target` is what the inputs write; `level` chases it every frame so a
    // coarse wheel notch or a keypress still reads as a dolly, not a cut.
    this.zoom = { level: 0, target: 0 }

    // Where the zoom is centred. Sliding this towards the point under the
    // cursor as the level rises is what keeps that point still on screen —
    // "zoom in on the thing I'm pointing at" rather than on the middle.
    this.zoomPivot = new Vector3()
    this.zoomPivotTarget = new Vector3()

    this.zoomParams = {
      // The limits are absolute camera distances, not relative levels: how far
      // in or out you can go should not depend on where the scroll happens to
      // have parked the camera. At the end of the dive the timeline sits at
      // 0.8, and a relative 2x cap from there could never show the whole disc.
      // Floor: the near plane sits at 0.02; the field is empty space at that
      // scale anyway. Ceiling: the sky shell is at 16, and from 10 it still
      // reads as a sky rather than a sphere of dots.
      minDistance: 0.05,
      maxDistance: 10,
      // Levels per pixel of ctrl+wheel (Chrome/Firefox report a trackpad pinch
      // that way). About one doubling per 300px of pinch travel.
      wheelSensitivity: 0.0033,
      // Levels per pixel of plain wheel. A mouse notch is around 100px, so this
      // is a little over a quarter of a doubling per notch — enough to feel the
      // dolly move, gentle enough that a trackpad's stream of small deltas
      // stays controllable.
      scrollSensitivity: 0.0028,
      // Levels per key press.
      keyStep: 0.5,
      // 1/s. How fast `level` closes on `target`. 12 settles in ~250ms.
      response: 12,
      // Sprite size shrinks by zoom^-falloff as the camera closes. Perspective
      // already grows every point 1:1 with the zoom; leaving that alone at 8x
      // turns 600k overlapping sprites into a fill-rate wall and a white smear.
      pointFalloff: 0.4,
      // Opacity exponent against magnification when zoomed *out* (see
      // `_update`); 1 keeps the disc's brightness roughly constant as it
      // shrinks instead of piling up to white.
      farFade: 0.8,
      // How far off-centre the aim may wander, as a fraction of the galaxy
      // radius. 1 = the rim.
      reach: 1,
      // Viewports of travel that give back about two thirds of a user zoom.
      // See `_releaseZoom()` — this is what stops a zoom from multiplying into
      // every shot the story composes after it.
      release: 0.4,
      // Levels of wheel the zoom has to refuse before the surplus pushes the
      // story instead. See `_advance()`.
      spill: 0.05
    }

    // Travelling the story. The wheel belongs to the scene, so advancing the
    // page is a drag: vertical movement scrolls the document, which is still
    // the single source of truth the whole timeline is scrubbed from.
    this.travel = { velocity: 0, remainder: 0 }

    this.travelParams = {
      // Document pixels per pixel of vertical drag. Above 1 because the
      // document is a dozen viewports tall and hauling it 1:1 would be a chore.
      sensitivity: 2.6,
      friction: 0.94,
      // Same reasoning as the spin's cap: one coarse pointermove carrying
      // hundreds of pixels must not fling the story through three acts.
      maxVelocity: 90,
      velocitySmoothing: 0.35
    }

    // Panning: dragging the aim around the view plane. Right/middle mouse
    // button, shift+drag, or two fingers moving together on touch. Client
    // position of the last event, and whether a pan is in progress.
    this.pan = { active: false, x: 0, y: 0 }

    // Two-finger pinch on touch. Pointer id -> last client position.
    this.pinch = { pointers: new Map(), distance: 0, midX: 0, midY: 0 }

    // Safari (macOS + iOS) reports trackpad/touch pinch through gesture events
    // rather than ctrl+wheel. Tracked so the two paths never both fire.
    this.gesture = { active: false, scale: 1 }

    // Where the cursor last pointed on the galaxy plane, and the smoothed
    // version the camera actually aims at.
    // The grain the flight is aimed at, in the field's own frame, and the same
    // point in world space once the disc's rotation has been applied. Storing
    // it locally is what keeps the aim pinned to that one grain while the disc
    // keeps turning underneath it.
    this.diveTargetLocal = new Vector3()
    this.diveTargetRaw = new Vector3()
    this.diveTarget = new Vector3()
    this.aim = new Vector3()

    this.diveParams = {
      // Never aim right at the rim — the flight should end up inside the disc,
      // where there is still something to fly through.
      reach: 0.45,
      // How quickly the aim point chases the cursor. Low, so the flight path
      // stays smooth instead of snapping around with every twitch.
      easing: 0.04,
      // Extra point size at full dive, to sell the rush past the camera. Kept
      // modest: inflating every sprite is also the fastest way to turn the
      // inside of the disc into one saturated white patch.
      warp: 0.25
    }

    // Retuned for the black sky. The old threshold of 0.45 existed to keep the
    // purple backdrop from blooming; against a backdrop at zero luminance
    // nothing but the particles can bloom, so the threshold can drop far enough
    // for the cool end of the palette to glow too.
    this.bloomParams = {
      strength: 0.62,
      radius: 0.4,
      threshold: 0.2,
      // The galaxy is a different exposure. Bloom tuned for a few thousand
      // glyphs on black smears half a million stars into one soft glow, and
      // the fine structure — the whole point of the field — goes with it. So
      // the pass eases to these values as the galaxy fades in.
      galaxyStrength: 0.26,
      galaxyThreshold: 0.55,
      // Once the background has lifted to grey the threshold has to clear it,
      // or the whole frame glows.
      bodyStrength: 0.4,
      bodyThreshold: 0.42
    }

    // The sky. A real starfield is mostly stars you can barely see, which is
    // why it needs this many: the count is what puts a floor of faint grain
    // behind everything, and the power law in the generator makes sure only a
    // few percent of them ever stand out.
    this.starParams = {
      count: 9000,
      // Faint fuzzy background galaxies. Depth cue: the sky is not a shell.
      galaxyCount: 60,
      radius: 16,
      opacity: 1
    }

    // 2,879 instances can morph into the *shape* of a galaxy but can never look
    // like one — a real galaxy reads as continuous light, not as countable
    // points. This field supplies the light; the instances stay as the resolved
    // foreground stars on top of it.
    this.galaxyParams = {
      // A galaxy reads as continuous light, and continuity is a coverage
      // problem: below a few hundred thousand sprites the disc stays a swarm
      // of countable dots no matter how the generator is tuned.
      count: 600000,
      // Absorption, drawn as a separate multiplicative pass.
      dustCount: 120000,
      // Both counts are scaled by this on phones. The cost here is fill rate,
      // not vertices — the haze sprites are tens of pixels across and overlap
      // dozens deep — and that is exactly what a phone GPU is worst at.
      mobileScale: 0.28,
      opacity: 0.9,
      pointScale: 1,
      // Ceiling in CSS pixels on how large a single star may draw.
      maxPointSize: 22,
      // World units. Sprites nearer than this to the camera fade out, and are
      // gone by a fifth of it. The size cap alone does not save the frame once
      // the flight is inside the disc — see the note in `galaxy.vertex.glsl`.
      // Sized against the arrival, which parks the camera 0.45 out.
      nearFade: 0.38
    }

    this.debrisParams = {
      count: 90,
      // Radius around the origin kept clear so the shards never crowd the brain.
      clearRadius: 0.72,
      opacity: 0.26
    }

    this.clock = new Clock()

    this._resizeCb = () => this._onResize()
    this._mousemoveCb = e => this._onMousemove(e)
    this._pointerdownCb = e => this._onPointerdown(e)
    this._pointermoveCb = e => this._onPointermove(e)
    this._pointerupCb = e => this._onPointerup(e)
    this._wheelCb = e => this._onWheel(e)
    this._keydownCb = e => this._onKeydown(e)
    this._gestureStartCb = e => this._onGestureStart(e)
    this._gestureChangeCb = e => this._onGestureChange(e)
    this._gestureEndCb = e => this._onGestureEnd(e)
    this._contextmenuCb = e => this._onContextmenu(e)
    this._dblclickCb = e => this._onDblclick(e)
  }

  init() {
    this._createScene()
    this._createCamera()
    this._createRenderer()
    this._createComposer()
    this._createBackground()
    this._createStarfield()
    this._createDebris()
    this._createRaycaster()
    this._createLoader()
    this._checkMobile()

    this._loadModel().then(() => {
      this._createScrollTimeline()
      this._addListeners()

      this.renderer.setAnimationLoop(() => {
        stats.begin()

        const t0 = performance.now()

        this._update()
        this._render()

        this._perfSample(performance.now() - t0)

        stats.end()
      })

      window.__app = this

      console.log(this)
    })
  }

  /**
   * Dev-only frame timing. `?perf` makes every frame end with a 1x1 readPixels,
   * which forces the GPU to finish the frame before the CPU continues — the
   * only way to see the real per-frame cost from JS. Off by default because
   * the stall itself costs a few ms.
   */
  _perfSample(cpuMs) {
    if (!this.perf) this.perf = {}

    const p = this.perf

    if (p.samples === undefined) {
      p.samples = []
      p.enabled = new URLSearchParams(window.location.search).has('perf')
      p.pixel = new Uint8Array(4)
    }

    if (!p.enabled) return

    const gl = this.renderer.getContext()
    const t0 = performance.now()

    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.pixel)

    // cpu = JS submit time; sync = submit + wait for the GPU to finish, i.e.
    // the frame's true render cost when the GPU is the bottleneck.
    p.samples.push({ cpu: cpuMs, sync: cpuMs + performance.now() - t0, frame: t0 - (p.last || t0) })
    p.last = performance.now()

    if (p.samples.length > 600) p.samples.shift()
  }

  destroy() {
    this.renderer.dispose()
    this._removeListeners()
  }

  _update() {
    const elapsed = this.clock.getElapsedTime()

    // `Clock.getDelta()` cannot be mixed with `getElapsedTime()` — they share
    // `oldTime` and would consume each other's interval.
    const delta = elapsed - this.elapsed

    this.elapsed = elapsed

    const progress = this.morph.progress

    this.debris.material.uniforms.uTime.value = elapsed
    this.stars.material.uniforms.uTime.value = elapsed

    // The dust drifts harder than a shaped body — there is no silhouette to
    // protect between the galaxy and the organism.
    const dustness = MathUtils.smoothstep(progress, 0.6, 1)*(1 - MathUtils.smoothstep(progress, 2, 2.9))

    const flow = this.lifeParams.flow*(1 + dustness*(this.lifeParams.cloudFlow - 1))

    // The resonance. Chaos before the wave, rhythm after; both fade out as the
    // grains take a shape and the ordinary flow takes over.
    const wave = this.story.wave
    const jitter = this.storyParams.jitter*dustness
    const sync = this.storyParams.sync*dustness

    const shared = [this.brainMaterial, this.links.material, this.spark.material]

    shared.forEach(material => {
      const u = material.uniforms

      u.uProgress.value = progress
      u.uTime.value = elapsed
      u.uFlow.value = flow
      u.uBreath.value = this.lifeParams.breath
      u.uSync.value = sync
      if (u.uWave) u.uWave.value = wave
      if (u.uJitter) u.uJitter.value = jitter
    })

    this.brainMaterial.uniforms.uDust.value = dustness

    // The wires: nothing before the light, sparks as it passes, then synapses.
    // Four thousand additive lines packed into a brain would burn the frame
    // white, so they dim hard as the field draws in and the form takes over.
    const linkOpacity =
      MathUtils.lerp(1, 0.65, MathUtils.smoothstep(progress, 2, 3))
      *MathUtils.lerp(1, 0.55, MathUtils.smoothstep(progress, 3, 4))

    this.links.material.uniforms.uOpacity.value = linkOpacity
    this.links.visible = wave > 0.001

    // The source: flares as the first grain is struck, then settles to an
    // ember and goes out as the body forms.
    const strike = MathUtils.smoothstep(wave, 0, 0.04)*(1 - MathUtils.smoothstep(wave, 0.08, 0.5))
    const ember = MathUtils.smoothstep(wave, 0.03, 0.2)*0.18*(1 - MathUtils.smoothstep(progress, 2.2, 2.9))

    this.spark.material.uniforms.uIntensity.value = strike + ember
    this.spark.visible = strike + ember > 0.002

    // The dense field is the cosmos. It is 600k sprites standing in for light
    // the 2,879 instances could never carry on their own; once the flight is
    // deep enough that individual grains resolve, the instances take over and
    // the field goes.
    //
    // One monotone curve over the whole passage, read off the timeline's own
    // clock rather than off the camera. That distinction is the difference
    // between a fade and a step: `dive.amount` *unwinds* during the arrival, so
    // anything keyed to it releases its suppression halfway through — the field
    // surged 68% brighter and only then went out. The camera comes back; the
    // story does not.
    //
    // Starting the fade when the flight starts also means there is nothing left
    // to do at the handover. Most of it has already happened by then, which is
    // what makes the join invisible rather than merely smooth.
    const { storyMarks: marks } = this

    const galaxyness = marks
      ? 1 - MathUtils.smoothstep(this.scrollTimeline.time(), marks.dive, marks.dust)
      : 1

    const galaxyOpacity = galaxyness*this.galaxyParams.opacity

    // The sky fades as the background lifts.
    this.stars.material.uniforms.uOpacity.value =
      this.starParams.opacity*(1 - MathUtils.smoothstep(progress, 2.2, 3.4))

    this._updateBackground(progress)

    this.brainMaterial.uniforms.uDive.value = this.dive.amount

    // Pulling far out, the sprites shrink below a pixel and stop shrinking —
    // gl_PointSize floors at 1 — so an additive stack that used to be spread
    // over hundreds of pixels lands on one and blows out to white. Real surface
    // brightness is distance-invariant; this restores that by fading each
    // sprite in step with the area it should have covered.
    const zoomOut = Math.min(1, Math.pow(2, this.zoom.level))
    const farFade = Math.pow(zoomOut, this.zoomParams.farFade)

    this.galaxyField.material.uniforms.uTime.value = elapsed
    this.galaxyField.material.uniforms.uOpacity.value = galaxyOpacity*farFade
    this.galaxyField.visible = this.galaxyReady && galaxyOpacity > 0.002

    const bodyness = MathUtils.smoothstep(progress, 2, 3.2)

    const { bloomParams: b } = this

    this.bloomPass.strength = MathUtils.lerp(
      MathUtils.lerp(b.strength, b.bodyStrength, bodyness), b.galaxyStrength, galaxyness
    )
    this.bloomPass.threshold = MathUtils.lerp(
      MathUtils.lerp(b.threshold, b.bodyThreshold, bodyness), b.galaxyThreshold, galaxyness
    )

    // The dust has to arrive with the light it is hiding — fading it in on its
    // own schedule would darken an empty frame.
    this.galaxyDust.material.uniforms.uOpacity.value =
      galaxyOpacity/this.galaxyParams.opacity
    this.galaxyDust.visible = this.galaxyField.visible

    // The debris shards earn their keep around a single centred body, not
    // around a galaxy or a cloud of dust — so they only appear with the brain.
    this.debris.material.uniforms.uOpacity.value =
      this.debrisParams.opacity*MathUtils.smoothstep(progress, 3.2, 4)

    this._updateSpin(delta)
    this._updateTravel()

    this._releaseZoom()
    this._updateZoom(delta)
    this._updateCamera()
  }

  /**
   * Hands a user zoom back to the timeline as the story travels.
   *
   * The camera distance is `base/magnification`: the timeline animates `base`,
   * the user's zoom divides it. Left sticky, that division rides along for the
   * rest of the piece and quietly ruins every shot after it — most visibly the
   * arrival, whose whole choreography is the flight closing to 0.45. Zoomed
   * out two levels, the dive's approach is divided straight back out again and
   * the handover never happens even though `progress` has moved on.
   *
   * So zoom is a deviation, not a state: look all you like, and the moment the
   * story moves it starts giving the framing back. Decay is against scroll
   * distance rather than time, so it is the *travel* that reclaims the camera —
   * sitting still and studying something never takes it away from you.
   */
  _releaseZoom() {
    const scroll = window.scrollY

    if (this._lastScroll === undefined) this._lastScroll = scroll

    const moved = Math.abs(scroll - this._lastScroll)

    this._lastScroll = scroll

    if (!moved || this.zoom.target === 0) return

    const k = 1 - Math.exp(-moved/(window.innerHeight*this.zoomParams.release))

    this.zoom.target -= this.zoom.target*k

    // The aim comes back to centre with it, or the story's shots stay parked
    // off to one side long after the zoom that pushed them there is gone.
    this.zoomPivotTarget.multiplyScalar(1 - k)

    if (Math.abs(this.zoom.target) < 1e-3) {
      this.zoom.target = 0
      this.zoomPivotTarget.set(0, 0, 0)
    }
  }

  /**
   * Eases the zoom level and its pivot towards their targets. Exponential
   * approach with a real time constant, so the feel is identical at 30, 60 or
   * 120Hz — a per-frame lerp factor would settle four times faster on a
   * ProMotion display than on a throttled laptop.
   */
  _updateZoom(delta) {
    const k = 1 - Math.exp(-this.zoomParams.response*Math.max(0, delta))

    this.zoom.level += (this.zoom.target - this.zoom.level)*k
    this.zoomPivot.lerp(this.zoomPivotTarget, k)

    // Snap the last sub-pixel of easing so the loop is genuinely idle at rest.
    if (Math.abs(this.zoom.target - this.zoom.level) < 1e-4) this.zoom.level = this.zoom.target
  }

  /**
   * Recomposes the camera every frame from its independent inputs: the dive
   * (where it is flying to), the scroll-driven distance, the user zoom, and the
   * mouse parallax. Nothing writes `camera.position` directly — the distance
   * used to be reassigned to a literal here, which silently killed any tween
   * on it.
   */
  _updateCamera() {
    // Where the aimed-at grain is right now. `_updateSpin` has already
    // refreshed the matrix this frame, so the aim tracks that one grain
    // through the disc's rotation instead of drifting off it.
    this.diveTargetRaw
      .copy(this.diveTargetLocal)
      .applyMatrix4(this.instancedMesh.matrixWorld)

    // Chase it slowly, so the flight path is a curve rather than a series of
    // jerks as the cursor moves from grain to grain.
    this.diveTarget.lerp(this.diveTargetRaw, this.diveParams.easing)

    // The point the camera orbits slides from the origin out to the dive
    // target, so the flight happens around the cursor rather than the centre.
    // The zoom pivot then offsets that further towards whatever was pointed at
    // while zooming.
    this.aim
      .copy(this.diveTarget)
      .multiplyScalar(this.dive.amount)
      .add(this.zoomPivot)

    // 2^-level: each zoom level halves the distance.
    const magnification = Math.pow(2, this.zoom.level)
    const distance = MathUtils.clamp(
      this.cameraDistance.base*this.cameraDistance.scale/magnification,
      this.zoomParams.minDistance,
      this.zoomParams.maxDistance
    )

    // Parallax is a fixed world-space offset, tuned for a camera a unit or two
    // out. Eight times closer it would sweep the aim clean off the frame, so it
    // shrinks with the distance and stays a constant fraction of the view.
    const parallaxScale = 1/magnification

    this.camera.position.set(
      this.aim.x + this.parallax.x*parallaxScale,
      this.aim.y + this.parallax.y*parallaxScale,
      this.aim.z + distance
    )

    this.camera.lookAt(this.aim)

    const pointScale =
      this.galaxyParams.pointScale
      *(1 + this.dive.amount*this.diveParams.warp)
      *Math.pow(Math.max(1, magnification), -this.zoomParams.pointFalloff)

    this.galaxyField.material.uniforms.uScale.value = pointScale
    this.galaxyDust.material.uniforms.uScale.value = pointScale
  }

  /**
   * The zoom level range allowed right now: whatever keeps the camera between
   * `minDistance` and `maxDistance` given the distance the scroll has chosen.
   * Recomputed on demand because `base` moves with the page.
   */
  _zoomRange() {
    const rest = this.cameraDistance.base*this.cameraDistance.scale
    const { minDistance, maxDistance } = this.zoomParams

    return {
      min: Math.log2(rest/maxDistance),
      max: Math.log2(rest/minDistance)
    }
  }

  /**
   * The one entry point every zoom input goes through. `deltaLevel` is in log2
   * units (+1 = twice as close). `hit` is the world point under the cursor or
   * pinch centre, if there is one; the pivot moves so that point stays put on
   * screen while the camera closes on it.
   */
  _zoomBy(deltaLevel, hit = null) {
    if (!Number.isFinite(deltaLevel) || deltaLevel === 0) return

    const range = this._zoomRange()
    const from = this.zoom.target
    const to = MathUtils.clamp(from + deltaLevel, range.min, range.max)

    if (to === from) return

    this.zoom.target = to

    // Distance ratio, new over old.
    const r = Math.pow(2, from - to)

    if (to < 0) {
      // Zooming out past the scroll's own framing: ease the aim back towards
      // the centre in step with the distance, so backing all the way out
      // always ends with the shape framed, and never with a snap. Compounds to
      // exactly 2^level across any sequence of steps.
      this.zoomPivotTarget.multiplyScalar(Math.pow(2, to - Math.min(from, 0)))
      return
    }

    if (!hit) return

    // For a camera looking straight down its z axis at `aim`, moving the aim by
    // (1 - r) of the way to the point under the cursor, while the distance
    // scales by r, keeps that point under the cursor. This is the exact
    // Google-Maps zoom-to-cursor invariant, applied to the aim rather than a
    // pan offset. It uses the *target* aim, not the eased one, so a burst of
    // wheel notches composes correctly instead of chasing a moving frame.
    const aimTarget = this.diveTarget.clone().multiplyScalar(this.dive.amount).add(this.zoomPivotTarget)

    this.zoomPivotTarget.addScaledVector(hit.clone().sub(aimTarget), 1 - r)
    this._clampPivot()
  }

  /**
   * Never aim past the rim — there is nothing to look at out there, and a
   * pivot that drifts leaves the whole disc parked off-centre.
   */
  _clampPivot() {
    this.zoomPivotTarget.clampLength(0, this.galaxyRadius*this.zoomParams.reach)
  }

  /**
   * Slides the aim across the view plane by a screen-space delta in pixels.
   * The scene follows the pointer 1:1: the world size of a pixel at the aim's
   * depth is what the perspective frustum says it is.
   */
  _panBy(dx, dy) {
    const distance = this.camera.position.z - this.aim.z
    const worldPerPixel = 2*distance*Math.tan(MathUtils.degToRad(this.camera.fov)*0.5)/this.container.clientHeight

    // Dragging right moves the scene right, i.e. the aim left.
    this.zoomPivotTarget.x -= dx*worldPerPixel
    this.zoomPivotTarget.y += dy*worldPerPixel

    this._clampPivot()
  }

  /**
   * Public: back to the scroll's own framing, centred.
   */
  resetZoom() {
    this.zoom.target = 0
    this.zoomPivotTarget.set(0, 0, 0)
  }

  /**
   * Public: animate to an absolute zoom level (log2). `zoomTo(0)` resets.
   */
  zoomTo(level) {
    this._zoomBy(level - this.zoom.target)
  }

  /**
   * World point under a client position on whatever the particles currently
   * resemble, or null.
   */
  /**
   * The nearest grain to a world point, in the field's own frame.
   *
   * The proxy the cursor actually hits is a flat disc — a stand-in with no
   * stars in it — so aiming the flight at the raw hit meant aiming at an
   * arbitrary spot in empty space and hoping something was there. It lands on
   * one of the 2,879 grains instead: the flight ends *on* a node, and since
   * those same grains are what the dust is made of, the next act starts from
   * the exact thing that was flown into.
   *
   * A linear scan over 2,879 points per mouse move is nothing, and it saves
   * carrying a spatial index that would have to be rebuilt as the disc turns.
   */
  _nearestNode(worldPoint) {
    if (!this.galaxyNodes) return null

    const local = this.instancedMesh.worldToLocal(worldPoint.clone())

    // Never aim at the rim: the flight has to end up inside the disc, where
    // there is still material to fly through.
    const reach = this.galaxyRadius*this.diveParams.reach

    let best = null
    let bestDistance = Infinity

    this.galaxyNodes.forEach(node => {
      if (node.length() > reach) return

      const distance = node.distanceToSquared(local)

      if (distance < bestDistance) {
        bestDistance = distance
        best = node
      }
    })

    return best
  }

  _hitAt(clientX, clientY) {
    const x = clientX/this.container.offsetWidth*2 - 1
    const y = -(clientY/this.container.offsetHeight*2 - 1)

    this.raycaster.setFromCamera(this._pickMouse.set(x, y), this.camera)

    const hits = this.raycaster.intersectObject(this._raycastTarget())

    return hits.length > 0 ? hits[0].point : null
  }

  /**
   * Wheel deltas arrive in pixels, lines or pages depending on browser and
   * device. Everything downstream wants pixels.
   */
  _wheelPixels(e) {
    if (e.deltaMode === 1) return e.deltaY*16
    if (e.deltaMode === 2) return e.deltaY*window.innerHeight

    return e.deltaY
  }

  _render() {
    this.composer.render()
  }

  _createScene() {
    this.scene = new Scene()
  }

  _createCamera() {
    this.camera = new PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.02, 100)
    this.camera.position.set(0, 0, this.cameraDistance.base)

    // The background plane is parented to the camera, so the camera itself has
    // to be part of the graph for it to be traversed.
    this.scene.add(this.camera)
  }

  _createRenderer() {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: window.devicePixelRatio === 1
    })

    this.container.appendChild(this.renderer.domElement)

    // Dev: `?still` (or `?galaxy`) skips the canvas's 1s CSS fade-in. Headless
    // screenshots land mid-transition otherwise and the whole frame reads dark.
    const search = new URLSearchParams(window.location.search)

    if (search.has('still') || search.has('galaxy')) {
      this.renderer.domElement.style.transition = 'none'
    }

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))
    this.renderer.physicallyCorrectLights = true
  }

  _createComposer() {
    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.composer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))

    this.composer.addPass(new RenderPass(this.scene, this.camera))

    this.bloomPass = new UnrealBloomPass(
      new Vector2(this.container.clientWidth, this.container.clientHeight),
      this.bloomParams.strength,
      this.bloomParams.radius,
      this.bloomParams.threshold
    )

    // Bloom is a blur; it does not need to be computed at full resolution to
    // look like one. Halving the internal mip chain quarters its fill cost
    // (five blur passes each way), and the composite is still full-res. The
    // composer calls setSize on resize, so the override has to live here.
    const setSize = this.bloomPass.setSize.bind(this.bloomPass)

    this.bloomPass.setSize = (width, height) => setSize(width*0.5, height*0.5)
    this.bloomPass.setSize(this.container.clientWidth, this.container.clientHeight)

    this.composer.addPass(this.bloomPass)
  }

  /**
   * Draws the page gradient inside the scene. The CSS gradient on `html` is left
   * in place as the pre-load fallback, but the bloom pass can only composite
   * against pixels the renderer produced, so it needs its own copy.
   */
  _createBackground() {
    this.backgroundStages.forEach(stage => {
      stage.innerColor = new Color(stage.inner)
      stage.outerColor = new Color(stage.outer)
    })

    const material = new ShaderMaterial({
      vertexShader: require('./shaders/background.vertex.glsl'),
      fragmentShader: require('./shaders/background.fragment.glsl'),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        // Deep space. Not a flat #000 — a barely-there lift at the centre keeps
        // the frame from reading as a dead rectangle, but it stays well under
        // the bloom threshold so it never glows.
        uColorInner: { value: new Color(0x0B0713) },
        uColorOuter: { value: new Color(0x000000) },
        uAspect: { value: this.camera.aspect }
      }
    })

    this.background = new Mesh(new PlaneGeometry(1, 1), material)
    this.background.position.z = -BACKGROUND_DISTANCE
    this.background.renderOrder = -1
    this.background.frustumCulled = false

    this.camera.add(this.background)

    this._resizeBackground()
  }

  /**
   * Scales the background plane to exactly fill the frustum at its distance, so
   * its UVs line up with the viewport and the gradient matches the CSS one.
   */
  _resizeBackground() {
    const height = 2*BACKGROUND_DISTANCE*Math.tan(MathUtils.degToRad(this.camera.fov)*0.5)

    this.background.scale.set(height*this.camera.aspect, height, 1)
    this.background.material.uniforms.uAspect.value = this.camera.aspect
  }

  /**
   * Eases the background between its stages by story progress. Piecewise
   * linear in the stage table; the eye reads it as a slow dawn.
   */
  _updateBackground(progress) {
    const stages = this.backgroundStages
    const u = this.background.material.uniforms

    let i = 0

    while (i < stages.length - 2 && progress > stages[i + 1].at) i++

    const a = stages[i]
    const b = stages[i + 1]
    const t = MathUtils.clamp((progress - a.at)/(b.at - a.at), 0, 1)

    u.uColorInner.value.copy(a.innerColor).lerp(b.innerColor, t)
    u.uColorOuter.value.copy(a.outerColor).lerp(b.outerColor, t)
  }

  /**
   * The sky. Sits far enough out that the camera's parallax barely moves it, so
   * it behaves like a backdrop without being pinned to the camera — which would
   * look wrong the moment the camera turns.
   */
  _createStarfield() {
    const { count, galaxyCount, radius } = this.starParams
    const sky = skyPoints(count, radius, galaxyCount)

    const geometry = new BufferGeometry()

    geometry.setAttribute('position', new BufferAttribute(sky.positions, 3))
    geometry.setAttribute('aColor', new BufferAttribute(sky.colors, 3))
    geometry.setAttribute('aSize', new BufferAttribute(sky.sizes, 1))
    geometry.setAttribute('aPhase', new BufferAttribute(sky.phases, 1))
    geometry.setAttribute('aKind', new BufferAttribute(sky.kinds, 1))

    const material = new ShaderMaterial({
      vertexShader: require('./shaders/star.vertex.glsl'),
      fragmentShader: require('./shaders/star.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: this.starParams.opacity },
        uPixelRatio: { value: Math.min(1.5, window.devicePixelRatio) }
      }
    })

    this.stars = new Points(geometry, material)
    this.stars.frustumCulled = false

    this.scene.add(this.stars)
  }

  /**
   * The galaxy: a dense additive field of stars plus a multiplicative dust
   * layer, in one group so they spin together. The dust is absorption *in
   * front of* specific stars; spin one without the other and it turns into a
   * grey smear over the whole disc.
   *
   * Materials and empty geometries are created now, so every other system can
   * reference them from the first frame. The vertex data itself is generated
   * off-thread by galaxy.worker.js and swapped in when it arrives — a full
   * field is ~0.5s of CPU, and it used to be 15s on the main thread. Until
   * then the group simply draws nothing; the galaxy state is minutes of
   * scrolling away from the hero, so nobody sees the gap.
   */
  _createGalaxy(radius) {
    const pixelRatio = Math.min(1.5, window.devicePixelRatio)
    const normal = new Vector3().fromArray(GALAXY_NORMAL)

    this.galaxyField = new Points(new BufferGeometry(), new ShaderMaterial({
      vertexShader: require('./shaders/galaxy.vertex.glsl'),
      fragmentShader: require('./shaders/galaxy.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uNormal: { value: normal },
        uScale: { value: this.galaxyParams.pointScale },
        uMaxSize: { value: this.galaxyParams.maxPointSize },
        uColorRange: { value: COLOR_RANGE },
        uSizeRange: { value: SIZE_RANGE },
        uNearFade: { value: this.galaxyParams.nearFade },
        uPixelRatio: { value: pixelRatio }
      }
    }))

    this.galaxyField.frustumCulled = false
    this.galaxyField.visible = false
    this.galaxyField.renderOrder = 0

    this.galaxyDust = new Points(new BufferGeometry(), new ShaderMaterial({
      vertexShader: require('./shaders/dust.vertex.glsl'),
      fragmentShader: require('./shaders/dust.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: MultiplyBlending,
      uniforms: {
        uOpacity: { value: 0 },
        uNormal: { value: normal },
        uScale: { value: this.galaxyParams.pointScale },
        uMaxSize: { value: this.galaxyParams.maxPointSize*1.5 },
        uSizeRange: { value: SIZE_RANGE },
        uNearFade: { value: this.galaxyParams.nearFade },
        uPixelRatio: { value: pixelRatio }
      }
    }))

    this.galaxyDust.frustumCulled = false
    this.galaxyDust.visible = false

    // Has to composite over the field, not under it.
    this.galaxyDust.renderOrder = 1

    this.galaxy = new Group()
    this.galaxy.add(this.galaxyField)
    this.galaxy.add(this.galaxyDust)

    this.scene.add(this.galaxy)

    this.galaxyReady = false

    this._generateGalaxy(radius)
  }

  _galaxyCount(key) {
    const { mobileScale } = this.galaxyParams

    return Math.round(this.galaxyParams[key]*(this.isMobile ? mobileScale : 1))
  }

  /**
   * Kicks the generator off in a worker; falls back to the main thread if the
   * worker can't be constructed (file:// pages, some sandboxes).
   */
  _generateGalaxy(radius) {
    const request = {
      count: this._galaxyCount('count'),
      dustCount: this._galaxyCount('dustCount'),
      radius
    }

    const t0 = performance.now()

    const receive = ({ field, dust, timing }) => {
      this._setGalaxyData(field, dust)

      this.perf = this.perf || {}
      this.perf.gen = { ...timing, wall: performance.now() - t0 }
    }

    let worker = null

    try {
      worker = new Worker('./galaxy.worker.js')
    } catch (e) {
      worker = null
    }

    if (worker) {
      worker.onmessage = e => {
        receive(e.data)
        worker.terminate()
      }

      worker.onerror = () => {
        worker.terminate()
        receive(generateGalaxy(request.count, request.dustCount, request.radius))
      }

      worker.postMessage(request)
    } else {
      receive(generateGalaxy(request.count, request.dustCount, request.radius))
    }
  }

  /**
   * Swaps the generated buffers into the geometries. Colours and sizes arrive
   * as bytes: a quarter of the upload of floats, and the shaders unpack.
   */
  _setGalaxyData(field, dust) {
    const fieldGeometry = new BufferGeometry()

    fieldGeometry.setAttribute('position', new BufferAttribute(field.positions, 3))
    fieldGeometry.setAttribute('aColor', new BufferAttribute(field.colors, 3, true))
    fieldGeometry.setAttribute('aSize', new BufferAttribute(field.sizes, 1, true))

    const dustGeometry = new BufferGeometry()

    dustGeometry.setAttribute('position', new BufferAttribute(dust.positions, 3))
    dustGeometry.setAttribute('aVariation', new BufferAttribute(dust.variation, 1, true))
    dustGeometry.setAttribute('aSize', new BufferAttribute(dust.sizes, 1, true))
    dustGeometry.setAttribute('aOpacity', new BufferAttribute(dust.opacities, 1, true))

    this.galaxyField.geometry.dispose()
    this.galaxyDust.geometry.dispose()

    this.galaxyField.geometry = fieldGeometry
    this.galaxyDust.geometry = dustGeometry

    this.galaxyReady = true
  }

  /**
   * A second, much coarser instanced field drifting around the brain. Adds the
   * depth cue that a single centred object can't give on its own.
   */
  _createDebris() {
    const geometry = new TetrahedronGeometry(0.012)

    const material = new ShaderMaterial({
      vertexShader: require('./shaders/debris.vertex.glsl'),
      fragmentShader: require('./shaders/debris.fragment.glsl'),
      wireframe: true,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Color() },
        uRotation: { value: 0 },
        uSize: { value: 1 },
        uPhase: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: this.debrisParams.opacity }
      }
    })

    this.debris = new InstancedUniformsMesh(geometry, material, this.debrisParams.count)

    // An `InstancedMesh` is culled against its *base* geometry's bounding
    // sphere, not the extent of its instances, so a field this wide has to opt
    // out of culling entirely.
    this.debris.frustumCulled = false

    this.scene.add(this.debris)

    const dummy = new Object3D()

    for (let i = 0; i < this.debrisParams.count; i++) {
      let x, y

      // Rejection-sample until the shard lands outside the brain's silhouette.
      do {
        x = MathUtils.randFloat(-1.6, 1.6)
        y = MathUtils.randFloat(-1.1, 1.1)
      } while (Math.hypot(x, y) < this.debrisParams.clearRadius)

      dummy.position.set(x, y, MathUtils.randFloat(-1.1, 0.4))
      dummy.updateMatrix()

      this.debris.setMatrixAt(i, dummy.matrix)

      this.debris.setUniformAt('uRotation', i, MathUtils.randFloat(-0.35, 0.35))
      this.debris.setUniformAt('uSize', i, MathUtils.randFloat(0.5, 1.8))
      this.debris.setUniformAt('uPhase', i, MathUtils.randFloat(-1, 1))

      const colorIndex = MathUtils.randInt(0, this.colors.length - 1)
      this.debris.setUniformAt('uColor', i, this.colors[colorIndex])
    }
  }

  _createLoader() {
    this.loadingManager = new LoadingManager()

    this.loadingManager.onLoad = () => {
      document.documentElement.classList.add('model-loaded')
    }

    this.gltfLoader = new GLTFLoader(this.loadingManager)
  }

  /**
   * Load the 3D model and position a set of `InstancedMesh` on each vertex.
   */
  _loadModel() {
    return new Promise(resolve => {
      this.gltfLoader.load('./brain.glb', gltf => {
        // The brain model is not added to the scene because is not necessary
        // for the raycaster to work.
        this.brain = gltf.scene.children[0]

        const count = this.brain.geometry.attributes.position.count

        // Create the `InstancedMesh`
        const geometry = new TetrahedronGeometry(0.004)

        this.brainMaterial = new ShaderMaterial({
          vertexShader: require('./shaders/brain.vertex.glsl'),
          fragmentShader: require('./shaders/brain.fragment.glsl'),
          wireframe: true,
          uniforms: {
            // `uPointer`, `uHover` and `uProgress` hold the same value for every
            // instance, so they stay plain shared uniforms — see `_onMousemove()`.
            uPointer: { value: new Vector3() },
            uColor: { value: new Color() },
            uRotation: { value: 0 },
            uSize: { value: 0 },
            uHover: { value: this.uniforms.uHover },
            uProgress: { value: 0 },
            uTime: { value: 0 },
            uFlow: { value: this.lifeParams.flow },
            uBreath: { value: this.lifeParams.breath },
            uShimmer: { value: this.lifeParams.shimmer },
            uDive: { value: 0 },
            uWave: { value: 0 },
            uJitter: { value: 0 },
            uSync: { value: 0 },
            uDust: { value: 0 }
          }
        })

        this.instancedMesh = new InstancedUniformsMesh(geometry, this.brainMaterial, count)
        this.instancedMesh.frustumCulled = false

        // Add the `InstancedMesh` to the scene
        this.scene.add(this.instancedMesh)

        // Set the `uColor`, `uRotation` and `uSize` uniforms. The instance
        // positions live in the morph attributes now, not in `instanceMatrix`.
        this.instancePhases = new Float32Array(count)

        for (let i = 0; i < count; i++) {
          this.instancePhases[i] = MathUtils.randFloat(-1, 1)
          this.instancedMesh.setUniformAt('uRotation', i, this.instancePhases[i])

          this.instancedMesh.setUniformAt('uSize', i, MathUtils.randFloat(0.3, 3))

          const colorIndex = MathUtils.randInt(0, this.colors.length - 1)
          this.instancedMesh.setUniformAt('uColor', i, this.colors[colorIndex])
        }

        this._createMorphTargets(count)

        resolve()
      })
    })
  }

  /**
   * Builds one point cloud per state, each with exactly `count` points so the
   * vertex shader can `mix()` straight between them. Everything except the brain
   * is generated at runtime — no extra assets to author or ship.
   */
  _createMorphTargets(count) {
    this.brain.geometry.computeBoundingSphere()

    // Re-centre the brain on the origin so every shape — and every raycast
    // proxy — spins around the same pivot. Without this the proxies would orbit
    // a different point than the particles they stand in for.
    const offset = this.brain.geometry.boundingSphere.center.clone()

    this.brain.geometry.translate(-offset.x, -offset.y, -offset.z)
    this.brain.geometry.computeBoundingSphere()
    this.brain.geometry.computeBoundingBox()

    const radius = this.brain.geometry.boundingSphere.radius

    // The brain is wide and flat, so its bounding *sphere* is a poor guide for a
    // tall shape — matching the bulb to it makes the bulb overflow the frame.
    // Size the bulb off the brain's height instead.
    const brainSize = this.brain.geometry.boundingBox.getSize(new Vector3())

    const brainPositions = this.brain.geometry.attributes.position.array
    const brainPoints = []

    for (let i = 0; i < brainPositions.length; i += 3) {
      brainPoints.push(new Vector3(brainPositions[i], brainPositions[i + 1], brainPositions[i + 2]))
    }

    // Invisible stand-ins kept around so the raycaster has a surface to hit in
    // each state — the instanced mesh itself is far too sparse to hover.
    this.sphereProxy = createSphereMesh()
    this.galaxyProxy = createGalaxyMesh()

    // The galaxy is meant to dwarf everything else that comes after it.
    const galaxyRadius = radius*3.2

    this.galaxyRadius = galaxyRadius

    // The dust and the organism both sit around the brain's own size.
    const sphereScale = radius*1.1 / 0.5

    const dust = cloudPoints(count, radius*0.8)
    const organism = organismPoints(count, radius*1.05)
    const galaxy = galaxyPoints(count, galaxyRadius)

    this._createGalaxy(galaxyRadius)

    this.sphereProxy.scale.setScalar(sphereScale)
    this.galaxyProxy.scale.setScalar(galaxyRadius)

    // Give every target the same ordering so instance `i` travels to a
    // neighbouring destination instead of across the whole shape.
    // Kept as the flight's aiming set — see `_nearestNode()`.
    const targets = {
      aPosGalaxy: sortSpherically(galaxy),
      aPosDust: sortSpherically(dust),
      aPosOrganism: sortSpherically(organism),
      aPosBrain: sortSpherically(brainPoints)
    }

    Object.entries(targets).forEach(([name, points]) => {
      this.instancedMesh.geometry.setAttribute(name, new InstancedBufferAttribute(pointsToArray(points), 3))
    })

    this.galaxyNodes = targets.aPosGalaxy

    this._createResonance(targets)

    this.spinTargets = [
      this.instancedMesh,
      this.links,
      this.spark,
      this.galaxy,
      this.brain,
      this.sphereProxy,
      this.galaxyProxy
    ]
  }

  /**
   * The connections and the light that starts them. Wires each grain to a
   * couple of neighbours, walks the wave through that graph, and builds the
   * line geometry — every line vertex carries both endpoints' four shapes so
   * the vertex shader can keep it pinned to the grains it joins.
   */
  _createResonance(targets) {
    const { pairs, activation, origin } = buildResonanceGraph(targets.aPosDust, targets.aPosOrganism, targets.aPosBrain)

    const count = activation.length

    this.instancedMesh.geometry.setAttribute('aActivate', new InstancedBufferAttribute(activation, 1))

    // Segments per line. Straight lines can't be lightning; four kinks can.
    const segments = 4
    const vertsPerLine = segments*2
    const total = pairs.length*vertsPerLine

    const arrays = {}

    ;['aAGalaxy', 'aADust', 'aAOrganism', 'aABrain', 'aBGalaxy', 'aBDust', 'aBOrganism', 'aBBrain'].forEach(name => {
      arrays[name] = new Float32Array(total*3)
    })

    const meta = new Float32Array(total*3)
    const phase = new Float32Array(total*2)

    // The instances' per-instance phase seeds are their `uRotation`; the line
    // ends have to jitter exactly as the grains they sit on.
    const phases = this.instancePhases

    const shapes = ['Galaxy', 'Dust', 'Organism', 'Brain']

    let v = 0

    pairs.forEach(([a, b]) => {
      const act = Math.max(activation[a], activation[b])
      const seed = Math.random()

      for (let s = 0; s < segments; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e)/segments

          shapes.forEach(shape => {
            const pa = targets['aPos' + shape][a]
            const pb = targets['aPos' + shape][b]

            arrays['aA' + shape].set([pa.x, pa.y, pa.z], v*3)
            arrays['aB' + shape].set([pb.x, pb.y, pb.z], v*3)
          })

          meta[v*3] = t
          meta[v*3 + 1] = act
          meta[v*3 + 2] = seed
          phase[v*2] = phases[a]
          phase[v*2 + 1] = phases[b]

          v++
        }
      }
    })

    const geometry = new BufferGeometry()

    // `position` is what three counts vertices by; the shader never reads it.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(total*3), 3))
    Object.entries(arrays).forEach(([name, array]) => {
      geometry.setAttribute(name, new BufferAttribute(array, 3))
    })
    geometry.setAttribute('aMeta', new BufferAttribute(meta, 3))
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 2))

    const pixelRatio = Math.min(1.5, window.devicePixelRatio)

    this.links = new LineSegments(geometry, new ShaderMaterial({
      vertexShader: require('./shaders/link.vertex.glsl'),
      fragmentShader: require('./shaders/link.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uFlow: { value: this.lifeParams.flow },
        uBreath: { value: this.lifeParams.breath },
        uWave: { value: 0 },
        uJitter: { value: 0 },
        uSync: { value: 0 },
        uOpacity: { value: 1 },
        uPixelRatio: { value: pixelRatio },
        // Synapse: a cool violet-white. Flash: hot white.
        uColorLine: { value: new Color(0xB9A6FF) },
        uColorFlash: { value: new Color(0xFFFFFF) }
      }
    }))

    this.links.frustumCulled = false
    this.links.visible = false
    this.links.renderOrder = 2

    this.scene.add(this.links)

    // The source, on the first grain.
    const sparkGeometry = new BufferGeometry()

    sparkGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    shapes.forEach(shape => {
      const p = targets['aPos' + shape][origin]

      sparkGeometry.setAttribute('a' + shape, new BufferAttribute(new Float32Array([p.x, p.y, p.z]), 3))
    })
    sparkGeometry.setAttribute('aPhase', new BufferAttribute(new Float32Array([phases[origin]]), 1))

    this.spark = new Points(sparkGeometry, new ShaderMaterial({
      vertexShader: require('./shaders/spark.vertex.glsl'),
      fragmentShader: require('./shaders/spark.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uFlow: { value: this.lifeParams.flow },
        uBreath: { value: this.lifeParams.breath },
        uSync: { value: 0 },
        uIntensity: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uColor: { value: new Color(0xFFE2B0) }
      }
    }))

    this.spark.frustumCulled = false
    this.spark.visible = false
    this.spark.renderOrder = 3

    this.scene.add(this.spark)

    this.resonance = { pairs: pairs.length, origin }
  }

  /**
   * Maps scroll position onto the morph and the camera dolly. One scrubbed
   * timeline over the whole document, one timeline unit per section.
   */
  _createScrollTimeline() {
    // Dev shortcut: `?at=<seconds>` parks the timeline at that time (see the
    // `at` values logged as `app.storyMarks`), so a headless screenshot can
    // hit the frame being tuned instead of the hero. `?galaxy` is the hero.
    // The timeline is built without its ScrollTrigger in that case — with
    // `scrub` the trigger owns a smoothing tween that keeps easing the
    // timeline back towards the scroll position, and neither disable() nor
    // kill() reliably stops it before the first frame.
    const search = new URLSearchParams(window.location.search)
    const atParam = search.has('at') ? parseFloat(search.get('at')) : (search.has('galaxy') ? 0 : null)

    const timeline = gsap.timeline(atParam !== null ? { paused: true } : {
      scrollTrigger: {
        trigger: '#content',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1
      }
    })

    const {
      hold, morph, holdSpin, morphSpin, dive, diveDistance, arrive, dustDistance
    } = this.scrollParams
    const { waveDuration } = this.storyParams

    const marks = {}
    let at = 0

    const dwell = (name, duration = hold) => {
      marks[name] = at
      timeline.to(this.spin, { scroll: `+=${holdSpin}`, duration, ease: 'none' }, at)
      at += duration
    }

    const go = (progress, distance, duration = morph, spin = morphSpin) => {
      timeline
        .to(this.morph, { progress, duration, ease: 'none' }, at)
        .to(this.cameraDistance, { base: distance, duration, ease: 'none' }, at)
        .to(this.spin, { scroll: `+=${spin}`, duration, ease: 'none' }, at)
      at += duration
    }

    // Act 0 — the cosmos. The whole disc, then the flight in towards a star.
    // An exponential disc puts most of its light well inside the nominal
    // radius, so the camera can sit much closer than that radius suggests.
    dwell('galaxy')

    // Easing in means the approach accelerates as it closes, which is what
    // makes it read as travel rather than as a zoom slider. No spin here — the
    // disc turning while you fly into it is nauseating.
    marks.dive = at
    timeline
      .to(this.dive, { amount: 1, duration: dive, ease: 'power1.in' }, at)
      .to(this.cameraDistance, { base: diveDistance, duration: dive, ease: 'power1.in' }, at)
    at += dive

    // Arrival. There is no cut and no flash: the flight simply keeps going
    // until it is *among* the points, and at that range the smear of the dense
    // field resolves into separate grains that are already shaking. The camera
    // lets go of its dive target over the same stretch, so the drift back to
    // centre is part of the arrival rather than a jump hidden behind anything.
    //
    // `power2.out` on the camera and `none` on the morph on purpose: the
    // travel decelerates into the cloud while the shapes keep changing at a
    // constant rate, which is what stops the arrival reading as a stop.
    //
    // It barely backs off at all. Retreating here — this used to pull out to
    // 1.7, nearly four times — is the single thing that made the whole passage
    // read as diving twice: in, hauled back out, then in again for the acts
    // that follow. The point of the flight is to end up *among* the grains, so
    // it ends up among them and stays there.
    marks.arrive = at
    timeline
      .to(this.morph, { progress: 1, duration: arrive, ease: 'none' }, at)
      .to(this.dive, { amount: 0, duration: arrive, ease: 'power2.out' }, at)
      .to(this.cameraDistance, { base: dustDistance, duration: arrive, ease: 'power2.out' }, at)
      .to(this.spin, { scroll: `+=${morphSpin*0.5}`, duration: arrive, ease: 'none' }, at)
    at += arrive

    // Act 1 — dust. Nothing but a cloud of grains, each shaking on its own, in
    // the dark.
    marks.dust = at
    dwell('dustHold', hold*0.8)

    // Act 2 — resonance. One grain is struck; the light crosses the field
    // grain by grain, and each one it reaches falls into the shared rhythm and
    // wires itself to the next. `progress` moves 1→2 with the wave, so the
    // shader can tell "before" from "after" without a second clock.
    //
    // The camera withdraws here, and only here. Standing among the grains is
    // the right place to watch the first one get struck, and the wrong place to
    // watch the front cross the whole field — so the retreat is spread across
    // the wave's own three and a half units. Over that long it is a reveal
    // rather than a move, which is what the sharp pull at the arrival was not.
    marks.resonance = at
    timeline
      .to(this.story, { wave: 1, duration: waveDuration, ease: 'none' }, at)
      .to(this.morph, { progress: 2, duration: waveDuration, ease: 'none' }, at)
      .to(this.cameraDistance, { base: 1.5, duration: waveDuration, ease: 'power1.inOut' }, at)
      .to(this.spin, { scroll: `+=${holdSpin*0.6}`, duration: waveDuration, ease: 'none' }, at)
    at += waveDuration
    dwell('network', hold*0.7)

    // Act 3 — the organism. The wired field draws itself in to a body.
    marks.organism = at
    go(3, 1.35)
    dwell('organismHold')

    // Act 4 — the mind.
    marks.brain = at
    go(4, 1.2)
    dwell('brainHold')

    this.storyMarks = marks
    this.scrollTimeline = timeline

    if (atParam !== null) {
      timeline.time(MathUtils.clamp(atParam, 0, timeline.duration()))
    }
  }

  _createRaycaster() {
    this.mouse = new Vector2()
    // Scratch NDC for one-off picks (wheel, pinch) that must not disturb the
    // hover state `mouse` carries.
    this._pickMouse = new Vector2()
    this.raycaster = new Raycaster()
    this.intersects = []
    this.point = new Vector3()
  }

  /**
   * Whichever proxy the particles currently resemble. The cloud state has no
   * surface worth hovering, so it keeps the sphere.
   */
  _raycastTarget() {
    const progress = this.morph.progress

    if (progress < 0.5) return this.galaxyProxy
    if (progress > 3.5) return this.brain

    // The dust and the organism have no surface worth hovering; a sphere of
    // about their size stands in.
    return this.sphereProxy
  }

  _addListeners() {
    window.addEventListener('resize', this._resizeCb, { passive: true })
    window.addEventListener('mousemove', this._mousemoveCb, { passive: true })
    window.addEventListener('pointerdown', this._pointerdownCb)
    window.addEventListener('pointermove', this._pointermoveCb)
    window.addEventListener('pointerup', this._pointerupCb)
    window.addEventListener('pointercancel', this._pointerupCb)
    // Not passive: every wheel event is the scene's now, claimed from both the
    // document scroll and the browser's own ctrl+wheel page zoom.
    window.addEventListener('wheel', this._wheelCb, { passive: false })
    window.addEventListener('keydown', this._keydownCb)
    window.addEventListener('gesturestart', this._gestureStartCb, { passive: false })
    window.addEventListener('gesturechange', this._gestureChangeCb, { passive: false })
    window.addEventListener('gestureend', this._gestureEndCb)
    window.addEventListener('contextmenu', this._contextmenuCb)
    window.addEventListener('dblclick', this._dblclickCb)
  }

  _removeListeners() {
    window.removeEventListener('resize', this._resizeCb, { passive: true })
    window.removeEventListener('mousemove', this._mousemoveCb, { passive: true })
    window.removeEventListener('pointerdown', this._pointerdownCb)
    window.removeEventListener('pointermove', this._pointermoveCb)
    window.removeEventListener('pointerup', this._pointerupCb)
    window.removeEventListener('pointercancel', this._pointerupCb)
    window.removeEventListener('wheel', this._wheelCb, { passive: false })
    window.removeEventListener('keydown', this._keydownCb)
    window.removeEventListener('gesturestart', this._gestureStartCb, { passive: false })
    window.removeEventListener('gesturechange', this._gestureChangeCb, { passive: false })
    window.removeEventListener('gestureend', this._gestureEndCb)
    window.removeEventListener('contextmenu', this._contextmenuCb)
    window.removeEventListener('dblclick', this._dblclickCb)
  }

  /**
   * The wheel belongs to the scene: every notch is a dolly, and the document
   * never moves on its own. There used to be a hand-off — plain wheel scrolled
   * the page until it ran out, then started zooming — and that was one gesture
   * doing two different things depending on state you couldn't see. Travelling
   * the story is its own act now: drag vertically, or use the keys and the
   * scrollbar, which the browser still drives natively.
   *
   * ctrl/cmd+wheel is how Chrome and Firefox report a trackpad pinch. It lands
   * in the same place at its own sensitivity, so a pinch and a scroll always
   * agree about which way is closer.
   */
  _onWheel(e) {
    // Safari owns pinch through gesture events; if one is live this wheel is
    // the same motion reported twice.
    if (this.gesture.active) {
      e.preventDefault()
      return
    }

    e.preventDefault()

    const { wheelSensitivity, scrollSensitivity, spill } = this.zoomParams
    const sensitivity = (e.ctrlKey || e.metaKey) ? wheelSensitivity : scrollSensitivity

    // Pinch out and wheel up both arrive as negative deltaY: zoom in.
    const step = -this._wheelPixels(e)*sensitivity

    // A push latches for as long as the wheel keeps turning the same way.
    // Without this it would fire exactly once: the push hands the framing back,
    // the zoom suddenly has room again, and every notch after it silently goes
    // back to zooming — one push, then stuck in the same place as before.
    const push = this._push

    if (push && Math.sign(step) === push.direction && performance.now() - push.at < 900) {
      this._advance(push.direction)
      return
    }

    const before = this.zoom.target

    this._zoomBy(step, this._hitAt(e.clientX, e.clientY))

    // Whatever the zoom could not take — because the camera is already as close
    // or as far as it goes — pushes the story instead. Being at the closest the
    // camera can get, still pushing, and having nothing happen is exactly what
    // being stuck feels like; there is always somewhere for the gesture to go.
    const surplus = step - (this.zoom.target - before)

    if (Math.abs(surplus) > spill) this._advance(Math.sign(surplus))
  }

  /**
   * Pushes the story to its next resting point — one push, one act.
   *
   * Every act boundary is already recorded in `storyMarks`, in timeline units,
   * and the timeline maps linearly onto the document's scroll range. So the
   * next act is a scroll position, and the browser's own smooth scroll is what
   * carries the page there. Pushing forward while zoomed in also hands the
   * framing back on the way, since `_releaseZoom()` is watching that travel.
   */
  _advance(direction) {
    if (!this.storyMarks || !this.scrollTimeline) return

    // Refreshed even while a push is still settling, so a wheel that keeps
    // turning keeps the latch in `_onWheel` alive.
    this._push = { direction, at: performance.now() }

    if (this._advancing) return

    const range = document.documentElement.scrollHeight - window.innerHeight
    const duration = this.scrollTimeline.duration()

    if (range <= 0 || duration <= 0) return

    // Where the story is now, in the timeline's own units.
    const at = window.scrollY/range*duration

    // A mark this close is the one being sat on, not the one to go to —
    // without it a push at an act's own boundary would go nowhere.
    const slack = 0.05

    const marks = Object.values(this.storyMarks).sort((a, b) => a - b)

    const next = direction > 0
      ? marks.find(mark => mark > at + slack)
      : marks.slice().reverse().find(mark => mark < at - slack)

    // Past the last act in either direction, push to the end of the document
    // rather than refusing: the credits are down there too.
    const target = next === undefined ? (direction > 0 ? duration : 0) : next

    // A push means "take me to the next act as it was composed", so the zoom
    // deviation goes with it rather than riding along and dividing the shot.
    // This is the same thing `_releaseZoom()` does for a hand-driven travel,
    // only all at once — the eased `zoom.level` still glides there.
    this.zoom.target = 0
    this.zoomPivotTarget.set(0, 0, 0)

    this._advancing = true

    window.scrollTo({ top: Math.round(target/duration*range), behavior: 'smooth' })

    // The browser's smooth scroll reports no completion, and one wheel gesture
    // is a burst of events — without a lock a single flick would fire a dozen
    // pushes and shoot straight past the act it was aimed at.
    clearTimeout(this._advanceTimer)
    this._advanceTimer = setTimeout(() => { this._advancing = false }, 700)
  }

  /**
   * Moves the document by `pixels`, carrying the sub-pixel remainder. A slow
   * drag rounds to zero every frame otherwise, and the page never moves at all.
   */
  _travelBy(pixels) {
    if (!pixels) return

    this.travel.remainder += pixels

    const whole = Math.trunc(this.travel.remainder)

    if (!whole) return

    this.travel.remainder -= whole

    window.scrollBy(0, whole)
  }

  /**
   * The glide after a travel drag is released, mirroring the spin's. Without it
   * a hand-driven page feels dead next to the native scroll it replaced.
   */
  _updateTravel() {
    if (this.pointer.dragging) return

    const { friction } = this.travelParams

    this.travel.velocity *= friction

    if (Math.abs(this.travel.velocity) < 0.05) {
      this.travel.velocity = 0
      return
    }

    this._travelBy(this.travel.velocity)
  }

  /**
   * Safari's pinch. `e.scale` is cumulative from gesturestart, so the step is
   * the ratio against the last one seen.
   */
  _onGestureStart(e) {
    e.preventDefault()
    this.gesture.active = true
    this.gesture.scale = 1
  }

  _onGestureChange(e) {
    e.preventDefault()

    // On iOS the same pinch also comes through as two pointers; that path owns
    // it and this listener is only here to stop the page zooming.
    if (this.pinch.pointers.size >= 2) return

    const ratio = e.scale/this.gesture.scale

    this.gesture.scale = e.scale

    if (ratio > 0) this._zoomBy(Math.log2(ratio), this._hitAt(e.clientX, e.clientY))
  }

  _onGestureEnd() {
    this.gesture.active = false
  }

  /**
   * `+`/`=` and `-` step the zoom, `0` resets. Ignored while typing.
   */
  _onKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return

    const { keyStep } = this.zoomParams

    switch (e.key) {
      case '+':
      case '=':
        this._zoomBy(keyStep, this._hitAt(this.pointer.lastX, this.pointer.lastY))
        break
      case '-':
      case '_':
        this._zoomBy(-keyStep)
        break
      case '0':
        this.resetZoom()
        break
      default:
        return
    }

    e.preventDefault()
  }

  /**
   * Distance and centre of the two tracked pinch pointers.
   */
  _pinchGeometry() {
    const [a, b] = this.pinch.pointers.values()

    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x)*0.5,
      midY: (a.y + b.y)*0.5
    }
  }

  _onPointerdown(e) {
    // Links and the credits still need to be clickable. `target` is not
    // guaranteed to be an `Element` — it can be the window or a text node — so
    // it can't be assumed to have `closest()`.
    if (e.target instanceof Element && e.target.closest('a')) return

    if (e.pointerType === 'touch') {
      this.pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (this.pinch.pointers.size === 2) {
        // Second finger down: whatever the first was doing is now a pinch, not
        // a spin. Killing the drag here means the shape doesn't lurch when the
        // two fingers move at different speeds.
        this.pointer.down = false
        this.pointer.dragging = false
        this.spin.velocity = 0
        document.body.classList.remove('is-dragging')

        Object.assign(this.pinch, this._pinchGeometry())
        return
      }

      if (this.pinch.pointers.size > 2) return
    }

    // Right or middle button, or shift held: pan instead of spin. The left
    // button keeps spinning the shape, which is what the page teaches first.
    if (e.pointerType !== 'touch' && (e.button === 1 || e.button === 2 || e.shiftKey)) {
      e.preventDefault()

      this.pan.active = true
      this.pan.x = e.clientX
      this.pan.y = e.clientY
      document.body.classList.add('is-panning')
      return
    }

    this.pointer.down = true
    this.pointer.dragging = false
    this.pointer.x = e.clientX
    this.pointer.y = e.clientY
    this.pointer.startX = e.clientX
    this.pointer.startY = e.clientY

    // Grabbing stops both glides dead — catching a moving page and having it
    // keep sliding under the hand is the classic way a drag feels broken.
    this.spin.velocity = 0
    this.travel.velocity = 0
  }

  /**
   * The right button is a pan handle now, so its menu would fire on every
   * release. Links keep theirs.
   */
  _onContextmenu(e) {
    if (e.target instanceof Element && e.target.closest('a')) return

    e.preventDefault()
  }

  /**
   * Double-click / double-tap: back to the scroll's own framing.
   */
  _onDblclick(e) {
    if (e.target instanceof Element && e.target.closest('a')) return

    this.resetZoom()
  }

  _onPointermove(e) {
    this.pointer.lastX = e.clientX
    this.pointer.lastY = e.clientY

    if (e.pointerType === 'touch' && this.pinch.pointers.has(e.pointerId)) {
      this.pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (this.pinch.pointers.size >= 2) {
        const next = this._pinchGeometry()

        // Ratio of finger spacing is magnification: spread twice as far, one
        // level closer. Guard the degenerate start where both touches land on
        // the same pixel.
        if (this.pinch.distance > 4 && next.distance > 4) {
          this._zoomBy(Math.log2(next.distance/this.pinch.distance), this._hitAt(next.midX, next.midY))
        }

        // The two fingers moving together is a pan. Doing both in the same
        // event is what makes a pinch feel anchored: the point between the
        // fingers stays under them whether they spread, slide or both.
        this._panBy(next.midX - this.pinch.midX, next.midY - this.pinch.midY)

        Object.assign(this.pinch, next)
        return
      }
    }

    if (this.pan.active) {
      this._panBy(e.clientX - this.pan.x, e.clientY - this.pan.y)
      this.pan.x = e.clientX
      this.pan.y = e.clientY
      return
    }

    if (!this.pointer.down) return

    const dx = e.clientX - this.pointer.x
    const dy = e.clientY - this.pointer.y

    if (!this.pointer.dragging) {
      // Either axis may start the drag — a straight-up pull is a travel, and
      // testing X alone left it stuck until the hand wandered sideways.
      const moved = Math.hypot(e.clientX - this.pointer.startX, e.clientY - this.pointer.startY)

      if (moved < this.dragParams.threshold) return

      this.pointer.dragging = true
      document.body.classList.add('is-dragging')
    }

    this.pointer.x = e.clientX
    this.pointer.y = e.clientY

    const step = dx*this.dragParams.sensitivity
    const { maxVelocity, velocitySmoothing } = this.dragParams

    // The rotation itself follows the pointer exactly; only the velocity that
    // survives the release is smoothed and capped.
    this.spin.drag += step
    this.spin.velocity = MathUtils.clamp(
      MathUtils.lerp(this.spin.velocity, step, velocitySmoothing),
      -maxVelocity,
      maxVelocity
    )

    // Touch already has a native vertical scroll — `touch-action: pan-y` hands
    // it to the browser before these events ever fire — so travelling by hand
    // is the mouse's business only. Doing both would scroll twice.
    if (e.pointerType === 'touch') return

    // Vertical drags travel the story, horizontal ones spin the shape: one
    // gesture, two axes, and no mode to be in. Pulling up moves the content up,
    // the same direction of grab as flicking a page on a phone.
    const travel = -dy*this.travelParams.sensitivity

    this._travelBy(travel)

    this.travel.velocity = MathUtils.clamp(
      MathUtils.lerp(this.travel.velocity, travel, this.travelParams.velocitySmoothing),
      -this.travelParams.maxVelocity,
      this.travelParams.maxVelocity
    )
  }

  _onPointerup(e) {
    if (e && e.pointerType === 'touch') {
      const wasPinching = this.pinch.pointers.size >= 2

      this.pinch.pointers.delete(e.pointerId)

      // Lifting one finger of a pinch does not hand the remaining one a spin —
      // it would fling the shape from wherever that finger happens to be. A
      // fresh touch is needed to drag again.
      if (wasPinching) {
        this.pinch.distance = 0
        return
      }
    }

    if (this.pan.active) {
      this.pan.active = false
      document.body.classList.remove('is-panning')
    }

    this.pointer.down = false
    this.pointer.dragging = false
    document.body.classList.remove('is-dragging')
  }

  /**
   * Scroll-driven spin plus hand-driven spin, with the drag decaying into a
   * short glide once the pointer is released.
   */
  _updateSpin(delta = 0) {
    if (!this.pointer.dragging) {
      this.spin.velocity *= this.dragParams.friction
      this.spin.drag += this.spin.velocity
    }

    // Turns forever, with or without input, so an untouched page is never a
    // still image.
    this.spin.idle += delta*this.lifeParams.idleSpeed

    const y = this.spin.scroll + this.spin.drag + this.spin.idle

    this.spinTargets.forEach(target => {
      target.rotation.y = y

      // The proxies live outside the scene graph, so nothing else refreshes
      // their world matrix for the raycaster.
      target.updateMatrixWorld()
    })
  }

  _onMousemove(e) {
    const x = e.clientX / this.container.offsetWidth * 2 - 1
    const y = -(e.clientY / this.container.offsetHeight * 2 - 1)

    this.mouse.set(x, y)

    gsap.to(this.parallax, {
      x: x*0.15,
      y: y*0.1,
      duration: 0.5
    })

    this.raycaster.setFromCamera(this.mouse, this.camera)

    // Check if the ray casted by the `Raycaster` intersects with the current shape
    this.intersects = this.raycaster.intersectObject(this._raycastTarget())

    // In the galaxy, the same hit doubles as the point the flight aims at.
    // Clamped short of the rim so the dive ends up inside the disc. Not while
    // the user has zoomed in, though: once they are steering by hand, the aim
    // must not also chase the cursor — at 8x a wave of the mouse would sweep
    // the frame across most of the disc.
    if (this.morph.progress < 0.5 && this.intersects.length > 0 && this.zoom.target <= 0) {
      const node = this._nearestNode(this.intersects[0].point)

      if (node) this.diveTargetLocal.copy(node)
    }

    if (this.intersects.length === 0) { // Mouseleave
      if (this.hover) {
        this.hover = false
        this._animateHoverUniform(0)
      }
    } else { // Mouseenter
      if (!this.hover) {
        this.hover = true
        this._animateHoverUniform(1)
      }

      // The raycaster reports a world-space hit, but the shader compares
      // `uPointer` against the instance's *local* anchor. Now that the shape
      // spins, those are no longer the same space. Converting here also means
      // the ripple stays stuck to the surface point as the shape keeps turning.
      const hit = this.instancedMesh.worldToLocal(this.intersects[0].point.clone())

      // Tween the point to project on the current mesh
      gsap.to(this.point, {
        x: hit.x,
        y: hit.y,
        z: hit.z,
        overwrite: true,
        duration: 0.3,
        onUpdate: () => {
          this.brainMaterial.uniforms.uPointer.value.copy(this.point)
        }
      })
    }
  }

  _animateHoverUniform(value) {
    gsap.to(this.uniforms, {
      uHover: value,
      duration: 0.25,
      onUpdate: () => {
        this.brainMaterial.uniforms.uHover.value = this.uniforms.uHover
      }
    })
  }

  _checkMobile() {
    const isMobile = window.innerWidth < 767

    if (isMobile === this.isMobile) return

    const isFirstRun = this.isMobile === undefined

    this.isMobile = isMobile
    this._setCameraScale(isMobile ? 1.92 : 1, isFirstRun ? 0 : 0.6)
  }

  /**
   * Breakpoint adjustment, kept separate from the scroll timeline's `base` so a
   * resize can never stomp on a scroll-driven dolly.
   */
  _setCameraScale(scale, duration = 0.6) {
    if (duration === 0) {
      this.cameraDistance.scale = scale
      return
    }

    gsap.to(this.cameraDistance, { scale, duration, overwrite: 'auto', ease: 'power2.out' })
  }

  /**
   * Manual dolly, for driving the camera outside the scroll timeline.
   */
  _setCameraDistance(base, duration = 0.6) {
    if (duration === 0) {
      this.cameraDistance.base = base
      return
    }

    gsap.to(this.cameraDistance, { base, duration, overwrite: 'auto', ease: 'power2.out' })
  }

  _onResize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight)

    this._resizeBackground()
    this._checkMobile()

    ScrollTrigger.refresh()
  }
}

const app = new App('#app')
app.init()

// Exposed so the camera dolly and the morph can be driven from the console — and
// so whatever comes next has something to hang off.
window.app = app
