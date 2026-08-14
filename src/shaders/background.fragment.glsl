uniform vec3 uColorInner;
uniform vec3 uColorOuter;
uniform float uAspect;

varying vec2 vUv;

// Mirrors the CSS `radial-gradient(circle, #692a84 0%, #3c184c 65%)` that used to
// live on the `html` element. The gradient has to be part of the scene now: the
// bloom pass composites against what the renderer draws, not against the page.
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;

  // CSS defaults a `circle` gradient to `farthest-corner`, so 100% is the
  // distance from the centre to a corner.
  float maxDistance = length(vec2(0.5*uAspect, 0.5));
  float d = clamp(length(p) / (maxDistance*0.65), 0.0, 1.0);

  gl_FragColor = vec4(mix(uColorInner, uColorOuter, d), 1.0);
}
