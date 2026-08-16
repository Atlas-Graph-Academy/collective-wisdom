// The source: the light that strikes the first grain. One sprite, sitting on
// that grain, following it through the same field function.
attribute vec3 aGalaxy;
attribute vec3 aDust;
attribute vec3 aOrganism;
attribute vec3 aBrain;
attribute float aPhase;

uniform float uProgress;
uniform float uTime;
uniform float uFlow;
uniform float uBreath;
uniform float uSync;
uniform float uIntensity;
uniform float uPixelRatio;

varying float vIntensity;

#pragma glslify: fieldPosition = require(./modules/field.glsl)

void main() {
  vec3 p = fieldPosition(aGalaxy, aDust, aOrganism, aBrain, uProgress, uTime, uFlow, uBreath, 0.0, uSync, aPhase, 1.0);

  vec4 mvPosition = modelViewMatrix*vec4(p, 1.0);

  // A large soft glow that breathes with the flash.
  float size = (90.0 + 260.0*uIntensity)*uPixelRatio;

  gl_PointSize = size/max(0.05, -mvPosition.z);
  gl_Position = projectionMatrix*mvPosition;

  vIntensity = uIntensity;
}
