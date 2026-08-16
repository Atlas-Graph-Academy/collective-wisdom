// One vertex of a subdivided line between grain A and grain B. Both endpoints
// carry their four resting shapes so the line can be re-derived from the same
// function the instances use, and always lands on them.
attribute vec3 aAGalaxy;
attribute vec3 aADust;
attribute vec3 aAOrganism;
attribute vec3 aABrain;
attribute vec3 aBGalaxy;
attribute vec3 aBDust;
attribute vec3 aBOrganism;
attribute vec3 aBBrain;
// x: fraction along the line, y: activation time of the line, z: random seed.
attribute vec3 aMeta;
// The two endpoints' jitter phases (the instances' uRotation).
attribute vec2 aPhase;

uniform float uProgress;
uniform float uTime;
uniform float uFlow;
uniform float uBreath;
uniform float uWave;
uniform float uJitter;
uniform float uSync;
uniform float uPixelRatio;

varying float vFlash;
varying float vLit;
varying float vPulse;
varying float vT;

#pragma glslify: fieldPosition = require(./modules/field.glsl)

float hash(float n) {
  return fract(sin(n)*43758.5453123);
}

void main() {
  float t = aMeta.x;
  float activate = aMeta.y;
  float seed = aMeta.z;

  // A line lights when its later endpoint does — the spark has to arrive.
  float lit = step(activate, uWave);
  float since = uWave - activate;
  float flash = lit*(1.0 - smoothstep(0.0, 0.14, since));

  // Endpoint activation for the jitter: the endpoint that was struck earlier
  // is the one that has already fallen into rhythm.
  float litA = lit;
  float litB = lit;

  vec3 a = fieldPosition(aAGalaxy, aADust, aAOrganism, aABrain, uProgress, uTime, uFlow, uBreath, uJitter, uSync, aPhase.x, litA);
  vec3 b = fieldPosition(aBGalaxy, aBDust, aBOrganism, aBBrain, uProgress, uTime, uFlow, uBreath, uJitter, uSync, aPhase.y, litB);

  vec3 p = mix(a, b, t);

  // Lightning: while the flash lasts the line is a jagged bolt. The kinks
  // re-roll a few dozen times a second and are pinned at both ends.
  vec3 dir = b - a;
  float len = length(dir) + 1e-5;
  vec3 n = dir/len;
  vec3 perp1 = normalize(cross(n, vec3(0.37, 0.91, 0.17)) + vec3(1e-4));
  vec3 perp2 = cross(n, perp1);

  float frame = floor(uTime*28.0);
  float k1 = hash(seed*91.7 + t*13.1 + frame*0.731) - 0.5;
  float k2 = hash(seed*47.3 + t*29.7 + frame*1.213) - 0.5;
  float pin = sin(t*3.14159265);

  p += (perp1*k1 + perp2*k2)*len*0.55*pin*flash;

  // After the flash the line settles into a synapse; a faint pulse keeps
  // running down it so the network reads as alive, not as wiring.
  vPulse = smoothstep(0.75, 1.0, fract(uTime*0.22 - activate*2.5 + seed*0.4 - t*0.08));

  vFlash = flash;
  vLit = lit;
  vT = t;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
