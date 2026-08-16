attribute vec3 aPosGalaxy;
attribute vec3 aPosDust;
attribute vec3 aPosOrganism;
attribute vec3 aPosBrain;
// When the light reaches this grain, 0..1 along the wave.
attribute float aActivate;

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
// The story's resonance state, all set from JS per frame.
uniform float uWave;
uniform float uJitter;
uniform float uSync;
uniform float uDust;

varying vec3 vColor;

#define PI 3.14159265359

#pragma glslify: rotate = require(./modules/rotate.glsl)
#pragma glslify: fieldPosition = require(./modules/field.glsl)

void main() {
  float lit = step(aActivate, uWave);

  // The moment of being struck: a short white flare that decays as the front
  // moves on.
  float flash = lit*(1.0 - smoothstep(0.0, 0.12, uWave - aActivate));

  vec3 target = fieldPosition(
    aPosGalaxy, aPosDust, aPosOrganism, aPosBrain,
    uProgress, uTime, uFlow, uBreath,
    uJitter, uSync, uRotation, lit
  );

  // Distance between the point projected from the mouse and each instance
  float d = distance(uPointer, target);

  // Define the color depending on the above value
  float c = smoothstep(0.45, 0.1, d);

  // Per-instance size flicker. `uRotation` is already a random per-instance
  // value, so it doubles as the phase seed that stops the field pulsing in
  // lockstep.
  float shimmer = 1.0 + uShimmer*sin(uTime*1.7 + uRotation*PI*2.0);

  // In the galaxy these are resolved stars sitting on top of a dense field of
  // light, not graphic shapes in their own right, so they stay tiny and let the
  // field do the work. As the flight arrives they grow into the grains they
  // were all along — that handover is the transition, so nothing here may go to
  // zero while the field is fading or the frame empties out. `uDive` only
  // streaks them a little on the way in.
  float starlike = mix(0.15, 1.0, smoothstep(0.0, 1.0, uProgress))*(1.0 + uDive*0.8);

  // Unlit dust is small and dim; a struck grain swells for an instant.
  float grain = mix(1.0, 0.7, uDust*(1.0 - lit))*(1.0 + flash*1.6);

  // `starlike` multiplies the hover displacement too. Applying it only to the
  // base size left the cursor able to inflate a cluster of instances 8x while
  // everything around them had shrunk to nothing.
  float scale = (uSize*shimmer + c*8.*uHover)*starlike*grain;
  vec3 pos = position;
  pos *= scale;
  pos.xz *= rotate(PI*c*uRotation + PI*uRotation*0.43);
  pos.xy *= rotate(PI*c*uRotation + PI*uRotation*0.71);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + target, 1.0);

  // Dust before the light is ash-grey; the flash is white; a lit grain keeps
  // its own colour.
  vec3 ash = vec3(0.42, 0.40, 0.46);
  vec3 base = mix(uColor, ash, uDust*(1.0 - lit));

  vColor = mix(base, vec3(1.0, 0.98, 0.94), flash*0.9);
}
