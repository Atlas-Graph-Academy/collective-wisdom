uniform float uOpacity;

varying vec3 vColor;
varying float vFade;

void main() {
  float d = length(gl_PointCoord - 0.5)*2.0;

  if (d > 1.0) discard;

  float core = 1.0 - d;

  // A tight core sitting in a much wider skirt, rather than a single squared
  // falloff. One falloff gives a bead, and a field of beads stays countable no
  // matter how many you add; it is the overlap of the *skirts* that fuses
  // neighbouring stars into a continuous surface, which is the whole
  // difference between a particle system and a photograph of a galaxy.
  float profile = 0.52*pow(core, 5.0) + 0.48*pow(core, 1.7);

  gl_FragColor = vec4(vColor, uOpacity*profile*vFade);
}
