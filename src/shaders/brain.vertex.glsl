attribute vec3 aPosBrain;
attribute vec3 aPosBulb;
attribute vec3 aPosSphere;
attribute vec3 aPosCloud;
attribute vec3 aPosGalaxy;

uniform vec3 uPointer;
uniform vec3 uColor;
uniform float uRotation;
uniform float uSize;
uniform float uHover;
uniform float uProgress;
uniform float uTime;
uniform float uFlow;
uniform float uBreath;
uniform float uShimmer;
uniform float uDive;

varying vec3 vColor;

#define PI 3.14159265359

#pragma glslify: rotate = require(./modules/rotate.glsl)

/**
 * Blend between the four targets. `uProgress` runs 0..3, one unit per state, so
 * the scroll timeline can drive it as a single scalar.
 */
vec3 morphedPosition(float progress) {
  float p = clamp(progress, 0.0, 5.0);

  if (p < 1.0) {
    return mix(aPosBrain, aPosBulb, smoothstep(0.0, 1.0, p));
  }

  if (p < 2.0) {
    return mix(aPosBulb, aPosSphere, smoothstep(0.0, 1.0, p - 1.0));
  }

  if (p < 3.0) {
    return mix(aPosSphere, aPosCloud, smoothstep(0.0, 1.0, p - 2.0));
  }

  if (p < 4.0) {
    // Back home. The cloud is a passage, not a destination.
    return mix(aPosCloud, aPosBrain, smoothstep(0.0, 1.0, p - 3.0));
  }

  // And then outwards, on the same 2879 points.
  return mix(aPosBrain, aPosGalaxy, smoothstep(0.0, 1.0, p - 4.0));
}

/**
 * A two-octave sine flow field. Not divergence-free the way real curl noise is,
 * but it swirls, its octaves beat against each other so it never visibly loops,
 * and it costs a handful of sines per vertex instead of the eighteen noise
 * lookups a finite-difference curl would need.
 *
 * Sampling on the *target* position keeps it spatially coherent: neighbouring
 * points drift together, which is what reads as a fluid rather than as jitter.
 *
 * The spatial frequency is deliberately low. At 3.4 the field turned over
 * within ~0.3 units, which is the same scale as the brain's own features — the
 * central fold and the lower edge got smeared away and it read as a generic
 * blob. At 1.5 whole regions sway together and the silhouette survives.
 */
vec3 flowField(vec3 p, float t) {
  vec3 q = p*1.5;

  return vec3(
    sin(q.y + t*0.90) + 0.5*sin(q.z*2.1 - t*1.30),
    sin(q.z + t*1.10) + 0.5*sin(q.x*1.9 + t*0.70),
    sin(q.x + t*0.80) + 0.5*sin(q.y*2.3 - t*1.10)
  );
}

void main() {
  // The instance's anchor point. This used to come from `instanceMatrix`, which
  // could only ever hold one shape.
  vec3 target = morphedPosition(uProgress);

  // Nothing is ever allowed to sit still. Every point drifts through the flow
  // field and the whole shape breathes, so even a state the scroll is parked on
  // keeps evolving instead of freezing into a diagram.
  target += flowField(target, uTime*0.35)*uFlow;
  target *= 1.0 + sin(uTime*0.45)*uBreath;

  // Distance between the point projected from the mouse and each instance
  float d = distance(uPointer, target);

  // Define the color depending on the above value
  float c = smoothstep(0.45, 0.1, d);

  // Per-instance size flicker. `uRotation` is already a random per-instance
  // value, so it doubles as the phase seed that stops the field pulsing in
  // lockstep.
  float shimmer = 1.0 + uShimmer*sin(uTime*1.7 + uRotation*PI*2.0);

  // In the galaxy these are stars sitting on top of a dense field, not graphic
  // shapes in their own right, so they shrink towards points — and once the
  // flight is inside the disc they shrink away entirely. At that range a
  // wireframe triangle reads as a drawing pasted over a photograph, and the
  // piece has arrived somewhere the designed object no longer belongs.
  //
  // Scaling to nothing rather than fading avoids making an opaque material
  // transparent just to hide it.
  float starlike = mix(1.0, 0.15, smoothstep(4.0, 5.0, uProgress))
    * (1.0 - smoothstep(0.2, 0.75, uDive));

  // `starlike` multiplies the hover displacement too. Applying it only to the
  // base size left the cursor able to inflate a cluster of instances 8x while
  // everything around them had shrunk to nothing.
  float scale = (uSize*shimmer + c*8.*uHover)*starlike;
  vec3 pos = position;
  pos *= scale;
  pos.xz *= rotate(PI*c*uRotation + PI*uRotation*0.43);
  pos.xy *= rotate(PI*c*uRotation + PI*uRotation*0.71);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + target, 1.0);

  vColor = uColor;
}
