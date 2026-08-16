uniform vec3 uColor;

varying float vIntensity;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv)*2.0;

  // Hot core, long soft skirt.
  float core = exp(-r*r*18.0);
  float halo = exp(-r*3.2)*0.55;
  float a = (core + halo)*vIntensity;

  if (a < 0.003) discard;

  vec3 color = mix(uColor, vec3(1.0), core*0.8);

  gl_FragColor = vec4(color*a, a);
}
