uniform float uOpacity;

varying float vVariation;
varying float vOpacity;
varying float vFacing;

// Interstellar dust: extinction rises steeply towards the blue, so a thin
// veil transmits red light and blocks blue. On the plate this is why the
// lanes read as brown-red filaments over the light instead of black strokes
// drawn on top of it — and why an ordinary flat dark multiply looks drawn.
//
// The transmission ratio between channels is roughly that of a reddening law
// with R_V ≈ 3.1: A_B/A_R ≈ 1.6, A_G/A_R ≈ 1.25.
const vec3 EXTINCTION = vec3(1.0, 1.28, 1.62);

void main() {
  float d = length(gl_PointCoord - 0.5)*2.0;

  if (d > 1.0) discard;

  float core = 1.0 - d;
  float profile = 0.35*pow(core, 3.0) + 0.65*pow(core, 1.4);

  // Thin the stack as the view goes oblique. At face-on this is 1; edge-on it
  // is a quarter, which is roughly the factor by which the sprite pile-up
  // overshoots the true path-length gain.
  float angle = mix(0.12, 1.0, pow(smoothstep(0.0, 1.0, vFacing), 1.6));

  // vVariation is per-point variation of the optical depth.
  float tau = clamp(vOpacity*profile*uOpacity*vVariation*1.45*angle, 0.0, 6.0);

  vec3 transmission = exp(-tau*EXTINCTION);

  gl_FragColor = vec4(transmission, 1.0);
}
