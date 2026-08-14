attribute float aPhase;
attribute float aSize;

uniform float uTime;
uniform float uPixelRatio;

varying float vTwinkle;

#define TAU 6.28318530718

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  // Each star breathes on its own phase, so the sky never pulses as one.
  vTwinkle = 0.55 + 0.45*sin(uTime*0.9 + aPhase*TAU);

  gl_PointSize = aSize*uPixelRatio*(0.7 + 0.3*vTwinkle);
}
