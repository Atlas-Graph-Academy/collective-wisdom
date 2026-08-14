attribute vec3 aColor;
attribute float aSize;

uniform float uTime;
uniform float uPixelRatio;
uniform float uScale;
uniform float uMaxSize;

varying vec3 vColor;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * mvPosition;

  // Perspective attenuation, so the field behaves like real depth while the
  // camera dollies rather than staying a flat decal.
  //
  // The ceiling matters: 1/z runs away as the flight closes on a star, and
  // without it the last stretch of the dive is a handful of sprites the size of
  // the viewport blowing the whole frame to white.
  float size = aSize*uPixelRatio*uScale*(4.0 / max(0.001, -mvPosition.z));

  gl_PointSize = min(size, uMaxSize*uPixelRatio);

  vColor = aColor;
}
