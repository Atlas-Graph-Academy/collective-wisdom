uniform float uOpacity;

varying vec3 vColor;

void main() {
  float d = length(gl_PointCoord - 0.5);

  if (d > 0.5) discard;

  // Squared falloff gives a stellar profile — a bright centre with a soft
  // skirt — rather than the flat disc a linear ramp produces. Additive
  // blending then lets dense regions accumulate into a continuous haze, which
  // is the whole point: a galaxy reads as light, not as countable dots.
  float falloff = smoothstep(0.5, 0.0, d);

  gl_FragColor = vec4(vColor, uOpacity*falloff*falloff);
}
