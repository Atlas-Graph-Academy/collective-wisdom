uniform vec3 uColor;
uniform float uRotation;
uniform float uSize;
uniform float uPhase;
uniform float uTime;

varying vec3 vColor;

#define PI 3.14159265359

#pragma glslify: rotate = require(./modules/rotate.glsl)

void main() {
  // Each shard tumbles on its own axis at its own rate. `uRotation` is signed,
  // so roughly half of them spin the other way.
  float t = uTime*uRotation;

  vec3 pos = position*uSize;
  pos.xz *= rotate(t + PI*uPhase);
  pos.xy *= rotate(t*0.62 + PI*uPhase*0.5);

  vec4 mvPosition = instanceMatrix * vec4(pos, 1.0);

  // Slow vertical drift so the field never reads as a static backdrop.
  mvPosition.y += sin(uTime*0.28 + uPhase*PI*2.0)*0.035;

  gl_Position = projectionMatrix * modelViewMatrix * mvPosition;

  vColor = uColor;
}
