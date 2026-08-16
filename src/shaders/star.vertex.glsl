attribute float aPhase;
attribute float aSize;
attribute vec3 aColor;
attribute float aKind;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vTwinkle;
varying float vKind;

#define TAU 6.28318530718

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  // Scintillation. Two incommensurate frequencies so no star repeats, and
  // it is *seeing*, not a strobe: shallow, and shallower still on the bright
  // stars, which are what people actually watch.
  float brightness = max(aColor.r, max(aColor.g, aColor.b));
  float depth = mix(0.30, 0.10, clamp(brightness, 0.0, 1.0));
  float t = uTime*1.4 + aPhase*TAU;

  vTwinkle = 1.0 - depth*(0.5 + 0.35*sin(t) + 0.15*sin(t*2.7 + aPhase*11.0));

  // Galaxies do not twinkle.
  vTwinkle = mix(vTwinkle, 1.0, aKind);

  gl_PointSize = aSize*uPixelRatio*(0.85 + 0.15*vTwinkle);

  vColor = aColor;
  vKind = aKind;
}
