# Collective wisdom

A single field of 2,879 instanced triangles that morphs, on scroll, from a brain
through a lightbulb and a sphere, scatters, reassembles as the brain, and finally
opens out into a spiral galaxy you can fly into.

Forked from [kekkorider/threejs-dala](https://github.com/kekkorider/threejs-dala)
by Francesco Michelini, which recreates the WebGL module of the old
[Dala.ai](https://dala.ai) site (originally built by
[Green Chameleon](https://www.craftedbygc.com/)). The original MIT licence is
kept in `LICENSE`. Everything below the first state is added here.

## What's in it

- **Morphing.** Five targets on one set of instances, blended in the vertex
  shader from a single `uProgress` scalar. Every target except the brain is
  generated at runtime in `src/shapes.js` — no extra assets. Point ordering is
  sorted by latitude band so instances travel to a neighbouring destination
  rather than across the whole shape.
- **Scroll timeline.** GSAP ScrollTrigger, alternating dwell and morph segments,
  so a state can be sat in and looked at rather than flicked past. Scrolling
  during a dwell spins the shape; dragging left/right spins it by hand.
- **Continuous motion.** A flow field, a slow breath, per-instance shimmer and an
  idle rotation, so nothing is ever a still image.
- **Galaxy.** A 90,000-point field on an exponential disc with logarithmic arms,
  a dust lane and stellar-population colour. The instances can carry the galaxy's
  *shape*, but a galaxy reads as continuous light, so the density comes from
  this separate field.
- **Dive.** Scrolling past the galaxy flies the camera into it, aimed at whatever
  point the cursor is over.

## Running it

Developed against Node 22. Two things to know:

1. **Do not put this in a path containing spaces.** `deasync`, pulled in by
   Parcel 1, is built by node-gyp, which does not quote paths — the native build
   fails with a confusing missing-file error.
2. **Parcel 1 needs the legacy OpenSSL provider** on modern Node.

```shell
yarn install
```

```shell
NODE_OPTIONS=--openssl-legacy-provider yarn dev
```

Then open `http://localhost:1234`.

```shell
NODE_OPTIONS=--openssl-legacy-provider yarn build
```

Note that `yarn build` starts with `rm -rf dist`, which will pull the rug out
from under a running dev server — restart it afterwards.
