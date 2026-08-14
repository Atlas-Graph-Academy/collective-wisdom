
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
  ShaderMaterial,
  AdditiveBlending,
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

import {
  createBulbMesh,
  createSphereMesh,
  createGalaxyMesh,
  samplePointsOnMesh,
  fibonacciSphere,
  cloudPoints,
  galaxyPoints,
  spiralGalaxy,
  starPoints,
  sortSpherically,
  pointsToArray
} from './shapes'

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

    // 0 = brain, 1 = bulb, 2 = sphere, 3 = cloud. Driven by the scroll timeline.
    this.morph = { progress: 0 }

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

    this.pointer = { down: false, dragging: false, x: 0, startX: 0 }

    this.scrollParams = {
      // Timeline units. The dwell is what stops a fast flick from blowing
      // through every state — scroll spends it spinning in place instead.
      hold: 2,
      morph: 1.5,
      holdSpin: 0.75,
      morphSpin: 0.4,
      // The flight into the galaxy gets a long run so it can accelerate.
      dive: 3,
      // Camera distance at the end of it. Not as close as it could go: the
      // space between stars really is empty, and pushing all the way in parks
      // the frame in a void. This stops while there is still material streaming
      // past, which is what reads as travel.
      diveDistance: 0.8
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
    this.cameraDistance = { base: 1.2, scale: 1 }

    // Mouse parallax. Kept off `camera.position` itself so the dive can
    // recompose the camera from scratch each frame without fighting a tween.
    this.parallax = { x: 0, y: 0 }

    // The flight into the galaxy. 0 = orbiting the origin as usual, 1 = the
    // camera has travelled all the way onto the point under the cursor.
    this.dive = { amount: 0 }

    // Where the cursor last pointed on the galaxy plane, and the smoothed
    // version the camera actually aims at.
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
      // Extra point size at full dive, to sell the rush past the camera.
      warp: 0.55
    }

    // Retuned for the black sky. The old threshold of 0.45 existed to keep the
    // purple backdrop from blooming; against a backdrop at zero luminance
    // nothing but the particles can bloom, so the threshold can drop far enough
    // for the cool end of the palette to glow too.
    this.bloomParams = {
      strength: 0.62,
      radius: 0.4,
      threshold: 0.2
    }

    this.starParams = {
      count: 1400,
      radius: 16,
      opacity: 0.85
    }

    // 2,879 instances can morph into the *shape* of a galaxy but can never look
    // like one — a real galaxy reads as continuous light, not as countable
    // points. This field supplies the light; the instances stay as the resolved
    // foreground stars on top of it.
    this.galaxyParams = {
      count: 90000,
      opacity: 0.9,
      pointScale: 1,
      // Ceiling in CSS pixels on how large a single star may draw.
      maxPointSize: 22
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
    this._pointerupCb = () => this._onPointerup()
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

        this._update()
        this._render()

        stats.end()
      })

      console.log(this)
    })
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

    this.debris.material.uniforms.uTime.value = elapsed
    this.stars.material.uniforms.uTime.value = elapsed
    this.brainMaterial.uniforms.uTime.value = elapsed
    this.brainMaterial.uniforms.uProgress.value = this.morph.progress

    // Ramp the drift up as the shape passes through the cloud (progress 3) and
    // back down as it reassembles into the brain.
    const cloudness = 1 - Math.min(1, Math.abs(this.morph.progress - 3))

    this.brainMaterial.uniforms.uFlow.value =
      this.lifeParams.flow*(1 + cloudness*(this.lifeParams.cloudFlow - 1))

    // The dense field only exists for the last leg. Skipping the draw entirely
    // outside it keeps 90k points off the rest of the page.
    const galaxyOpacity =
      MathUtils.smoothstep(this.morph.progress, 4.05, 4.9)*this.galaxyParams.opacity

    this.brainMaterial.uniforms.uDive.value = this.dive.amount

    this.galaxyField.material.uniforms.uTime.value = elapsed
    this.galaxyField.material.uniforms.uOpacity.value = galaxyOpacity
    this.galaxyField.visible = galaxyOpacity > 0.002

    // The debris shards span roughly the galaxy's own radius, so they end up
    // floating *inside* it looking like litter. They earn their keep around a
    // single centred object, not around a galaxy — so they clear out.
    this.debris.material.uniforms.uOpacity.value =
      this.debrisParams.opacity*(1 - MathUtils.smoothstep(this.morph.progress, 4, 4.8))

    this._updateSpin(delta)

    this._updateCamera()
  }

  /**
   * Recomposes the camera every frame from its three independent inputs: the
   * dive (where it is flying to), the scroll-driven distance, and the mouse
   * parallax. Nothing writes `camera.position` directly — the distance used to
   * be reassigned to a literal here, which silently killed any tween on it.
   */
  _updateCamera() {
    // Chase the cursor's point on the galaxy plane. Slow, so the flight path is
    // a curve rather than a series of jerks.
    this.diveTarget.lerp(this.diveTargetRaw, this.diveParams.easing)

    // The point the camera orbits slides from the origin out to the dive
    // target, so "zoom in" happens around the cursor rather than the centre.
    this.aim.copy(this.diveTarget).multiplyScalar(this.dive.amount)

    const distance = this.cameraDistance.base*this.cameraDistance.scale

    this.camera.position.set(
      this.aim.x + this.parallax.x,
      this.aim.y + this.parallax.y,
      this.aim.z + distance
    )

    this.camera.lookAt(this.aim)

    this.galaxyField.material.uniforms.uScale.value =
      this.galaxyParams.pointScale*(1 + this.dive.amount*this.diveParams.warp)
  }

  _render() {
    this.composer.render()
  }

  _createScene() {
    this.scene = new Scene()
  }

  _createCamera() {
    this.camera = new PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 100)
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

    this.composer.addPass(this.bloomPass)
  }

  /**
   * Draws the page gradient inside the scene. The CSS gradient on `html` is left
   * in place as the pre-load fallback, but the bloom pass can only composite
   * against pixels the renderer produced, so it needs its own copy.
   */
  _createBackground() {
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
   * The sky. Sits far enough out that the camera's parallax barely moves it, so
   * it behaves like a backdrop without being pinned to the camera — which would
   * look wrong the moment the camera turns.
   */
  _createStarfield() {
    const positions = starPoints(this.starParams.count, this.starParams.radius)
    const phases = new Float32Array(this.starParams.count)
    const sizes = new Float32Array(this.starParams.count)

    for (let i = 0; i < this.starParams.count; i++) {
      phases[i] = Math.random()

      // Mostly faint pinpricks with a scattering of brighter ones.
      sizes[i] = MathUtils.randFloat(0.6, 1.0)**3*3.4 + 0.5
    }

    const geometry = new BufferGeometry()

    geometry.setAttribute('position', new BufferAttribute(pointsToArray(positions), 3))
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1))
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))

    const material = new ShaderMaterial({
      vertexShader: require('./shaders/star.vertex.glsl'),
      fragmentShader: require('./shaders/star.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(0xE8E4FF) },
        uOpacity: { value: this.starParams.opacity },
        uPixelRatio: { value: Math.min(1.5, window.devicePixelRatio) }
      }
    })

    this.stars = new Points(geometry, material)
    this.stars.frustumCulled = false

    this.scene.add(this.stars)
  }

  /**
   * The dense half of the galaxy. Built from the same generator as the morph
   * target, so the two overlay exactly, and faded in only across the final leg
   * — it is 90k points and there is no reason to draw them for the rest of the
   * page.
   */
  _createGalaxyField(radius) {
    const { count } = this.galaxyParams
    const { positions, colors, sizes } = spiralGalaxy(count, radius)

    const geometry = new BufferGeometry()

    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))

    const material = new ShaderMaterial({
      vertexShader: require('./shaders/galaxy.vertex.glsl'),
      fragmentShader: require('./shaders/galaxy.fragment.glsl'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uScale: { value: this.galaxyParams.pointScale },
        uMaxSize: { value: this.galaxyParams.maxPointSize },
        uPixelRatio: { value: Math.min(1.5, window.devicePixelRatio) }
      }
    })

    this.galaxyField = new Points(geometry, material)
    this.galaxyField.frustumCulled = false
    this.galaxyField.visible = false

    this.scene.add(this.galaxyField)
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
            uDive: { value: 0 }
          }
        })

        this.instancedMesh = new InstancedUniformsMesh(geometry, this.brainMaterial, count)
        this.instancedMesh.frustumCulled = false

        // Add the `InstancedMesh` to the scene
        this.scene.add(this.instancedMesh)

        this._createMorphTargets(count)

        // Set the `uColor`, `uRotation` and `uSize` uniforms. The instance
        // positions live in the morph attributes now, not in `instanceMatrix`.
        for (let i = 0; i < count; i++) {
          this.instancedMesh.setUniformAt('uRotation', i, MathUtils.randFloat(-1, 1))

          this.instancedMesh.setUniformAt('uSize', i, MathUtils.randFloat(0.3, 3))

          const colorIndex = MathUtils.randInt(0, this.colors.length - 1)
          this.instancedMesh.setUniformAt('uColor', i, this.colors[colorIndex])
        }

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
    this.bulbProxy = createBulbMesh()
    this.sphereProxy = createSphereMesh()
    this.galaxyProxy = createGalaxyMesh()

    // The galaxy is meant to dwarf everything else that came before it.
    const galaxyRadius = radius*3.2

    this.galaxyRadius = galaxyRadius

    // BULB_PROFILE spans 0.99 in Y, so this makes the bulb 1.35x the brain's height.
    const bulbScale = brainSize.y*1.35 / 0.99
    const sphereScale = radius*0.95 / 0.5

    const bulbPoints = samplePointsOnMesh(this.bulbProxy, count)
      .map(p => p.multiplyScalar(bulbScale))

    const spherePoints = fibonacciSphere(count, radius*0.95)
    const cloud = cloudPoints(count, radius)

    const galaxy = galaxyPoints(count, galaxyRadius)

    this._createGalaxyField(galaxyRadius)

    this.bulbProxy.scale.setScalar(bulbScale)
    this.sphereProxy.scale.setScalar(sphereScale)
    this.galaxyProxy.scale.setScalar(galaxyRadius)

    this.spinTargets = [
      this.instancedMesh,
      this.galaxyField,
      this.brain,
      this.bulbProxy,
      this.sphereProxy,
      this.galaxyProxy
    ]

    // Give every target the same ordering so instance `i` travels to a
    // neighbouring destination instead of across the whole shape.
    const targets = {
      aPosBrain: sortSpherically(brainPoints),
      aPosBulb: sortSpherically(bulbPoints),
      aPosSphere: sortSpherically(spherePoints),
      aPosCloud: sortSpherically(cloud),
      aPosGalaxy: sortSpherically(galaxy)
    }

    Object.entries(targets).forEach(([name, points]) => {
      this.instancedMesh.geometry.setAttribute(name, new InstancedBufferAttribute(pointsToArray(points), 3))
    })
  }

  /**
   * Maps scroll position onto the morph and the camera dolly. One scrubbed
   * timeline over the whole document, one timeline unit per section.
   */
  _createScrollTimeline() {
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: '#content',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1
      }
    })

    const { hold, morph, holdSpin, morphSpin } = this.scrollParams

    // States the timeline comes to rest on. `via` is a progress value a morph
    // passes straight through without dwelling: the cloud is the passage the
    // field scatters through on its way back to the brain, not a destination.
    const states = [
      { progress: 0, distance: 1.2 },
      { progress: 1, distance: 1.45 },
      { progress: 2, distance: 1.3 },
      { progress: 4, distance: 1.2, via: { progress: 3, distance: 2.2 } },
      // An exponential disc puts most of its light well inside the nominal
      // radius, so the camera can sit much closer than that radius suggests.
      { progress: 5, distance: 2.9 }
    ]

    let at = 0

    states.forEach((state, i) => {
      if (i > 0) {
        // Durations are explicit because gsap defaults to 0.5, which would
        // leave dead gaps between segments and desynchronise the camera from
        // the morph.
        const legs = state.via ? [state.via, state] : [state]

        legs.forEach(leg => {
          timeline
            .to(this.morph, { progress: leg.progress, duration: morph, ease: 'none' }, at)
            .to(this.cameraDistance, { base: leg.distance, duration: morph, ease: 'none' }, at)
            .to(this.spin, { scroll: `+=${morphSpin}`, duration: morph, ease: 'none' }, at)

          at += morph
        })
      }

      // Dwell. The silhouette holds and scrolling only spins it, so a state can
      // be sat in and looked at instead of being flicked past.
      timeline.to(this.spin, { scroll: `+=${holdSpin}`, duration: hold, ease: 'none' }, at)

      at += hold
    })

    // The flight in. Easing in means the approach accelerates as it closes,
    // which is what makes it read as travel rather than as a zoom slider. No
    // spin here — the disc turning while you fly into it is nauseating.
    const { dive, diveDistance } = this.scrollParams

    timeline
      .to(this.dive, { amount: 1, duration: dive, ease: 'power1.in' }, at)
      .to(this.cameraDistance, { base: diveDistance, duration: dive, ease: 'power1.in' }, at)

    this.scrollTimeline = timeline
  }

  _createRaycaster() {
    this.mouse = new Vector2()
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

    if (progress > 4.5) return this.galaxyProxy

    // The brain bookends the shaped states; the cloud in between has no surface
    // worth hovering, so it borrows the sphere.
    if (progress < 0.5 || progress > 3.5) return this.brain
    if (progress < 1.5) return this.bulbProxy

    return this.sphereProxy
  }

  _addListeners() {
    window.addEventListener('resize', this._resizeCb, { passive: true })
    window.addEventListener('mousemove', this._mousemoveCb, { passive: true })
    window.addEventListener('pointerdown', this._pointerdownCb)
    window.addEventListener('pointermove', this._pointermoveCb)
    window.addEventListener('pointerup', this._pointerupCb)
    window.addEventListener('pointercancel', this._pointerupCb)
  }

  _removeListeners() {
    window.removeEventListener('resize', this._resizeCb, { passive: true })
    window.removeEventListener('mousemove', this._mousemoveCb, { passive: true })
    window.removeEventListener('pointerdown', this._pointerdownCb)
    window.removeEventListener('pointermove', this._pointermoveCb)
    window.removeEventListener('pointerup', this._pointerupCb)
    window.removeEventListener('pointercancel', this._pointerupCb)
  }

  _onPointerdown(e) {
    // Links and the credits still need to be clickable. `target` is not
    // guaranteed to be an `Element` — it can be the window or a text node — so
    // it can't be assumed to have `closest()`.
    if (e.target instanceof Element && e.target.closest('a')) return

    this.pointer.down = true
    this.pointer.dragging = false
    this.pointer.x = e.clientX
    this.pointer.startX = e.clientX
    this.spin.velocity = 0
  }

  _onPointermove(e) {
    if (!this.pointer.down) return

    const delta = e.clientX - this.pointer.x

    if (!this.pointer.dragging) {
      if (Math.abs(e.clientX - this.pointer.startX) < this.dragParams.threshold) return

      this.pointer.dragging = true
      document.body.classList.add('is-dragging')
    }

    this.pointer.x = e.clientX

    const step = delta*this.dragParams.sensitivity
    const { maxVelocity, velocitySmoothing } = this.dragParams

    // The rotation itself follows the pointer exactly; only the velocity that
    // survives the release is smoothed and capped.
    this.spin.drag += step
    this.spin.velocity = MathUtils.clamp(
      MathUtils.lerp(this.spin.velocity, step, velocitySmoothing),
      -maxVelocity,
      maxVelocity
    )
  }

  _onPointerup() {
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
    // Clamped short of the rim so the dive ends up inside the disc.
    if (this.morph.progress > 4.5 && this.intersects.length > 0) {
      this.diveTargetRaw
        .copy(this.intersects[0].point)
        .clampLength(0, this.galaxyRadius*this.diveParams.reach)
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
