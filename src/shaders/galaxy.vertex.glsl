// Packed: colour bytes over [0, uColorRange], size byte over [0, uSizeRange].
attribute vec3 aColor;
attribute float aSize;

uniform float uTime;
uniform float uPixelRatio;
uniform float uScale;
uniform float uMaxSize;
uniform float uColorRange;
uniform float uSizeRange;
uniform float uNearFade;
uniform vec3 uNormal;

varying vec3 vColor;
varying float vFade;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * mvPosition;

  // Perspective attenuation, so the field behaves like real depth while the
  // camera dollies rather than staying a flat decal.
  //
  // The ceiling matters: 1/z runs away as the flight closes on a star, and
  // without it the last stretch of the dive is a handful of sprites the size of
  // the viewport blowing the whole frame to white.
  float size = aSize*uSizeRange*uPixelRatio*uScale*(4.0 / max(0.001, -mvPosition.z));

  gl_PointSize = min(size, uMaxSize*uPixelRatio);

  // Seen obliquely, the sprites of a thin disc pile up along the view ray and
  // the arms clip to white. Real discs do brighten towards edge-on, but by
  // far less than an additive stack does — so lean against it.
  vec3 normal = normalize((modelViewMatrix * vec4(uNormal, 0.0)).xyz);
  float facing = abs(dot(normal, normalize(-mvPosition.xyz)));

  // The sprites nearest the camera are what blow the frame out. The size cap
  // stops any one of them covering the viewport, but it does nothing about
  // *density*: fly in close and dozens of capped sprites overlap on the same
  // pixels, additive blending stacks them past 1, and the bloom pass spreads
  // that saturated patch into a smooth white ball. A star you fly past should
  // leave the frame rather than smear across it, so the near ones fade out.
  float near = smoothstep(uNearFade*0.2, uNearFade, -mvPosition.z);

  vFade = mix(0.55, 1.0, smoothstep(0.0, 1.0, facing))*near;

  vColor = aColor*uColorRange;
}
