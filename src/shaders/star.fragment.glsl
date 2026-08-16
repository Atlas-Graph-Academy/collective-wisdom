uniform float uOpacity;

varying vec3 vColor;
varying float vTwinkle;
varying float vKind;

void main() {
  float d = length(gl_PointCoord - 0.5)*2.0;

  if (d > 1.0) discard;

  float core = 1.0 - d;

  // A star on a sensor: a hard bright core inside a soft skirt. Bright ones
  // grow a wider skirt because that is what a point spread function does
  // when it is overexposed — the core clips and the wings show.
  float brightness = max(vColor.r, max(vColor.g, vColor.b));
  float skirt = mix(0.25, 0.65, clamp(brightness, 0.0, 1.0));
  float star = (1.0 - skirt)*pow(core, 6.0) + skirt*pow(core, 2.2);

  // A galaxy: no core at all, just a soft mound with a hint of a brighter
  // middle.
  float galaxy = 0.55*pow(core, 1.6) + 0.45*pow(core, 3.5);

  float profile = mix(star, galaxy, vKind);

  gl_FragColor = vec4(vColor*vTwinkle, uOpacity*profile);
}
