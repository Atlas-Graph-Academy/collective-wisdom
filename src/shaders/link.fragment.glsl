uniform float uOpacity;
uniform vec3 uColorLine;
uniform vec3 uColorFlash;

varying float vFlash;
varying float vLit;
varying float vPulse;
varying float vT;

void main() {
  // Rest state: a faint line, brighter towards its ends where it meets the
  // grains. Flash: full white. Pulse: a soft brightening running along it.
  float ends = 0.55 + 0.45*abs(vT - 0.5)*2.0;
  float rest = 0.5*ends + 0.6*vPulse;

  vec3 color = mix(uColorLine, uColorFlash, vFlash);
  float alpha = (rest + vFlash*1.4)*vLit*uOpacity;

  if (alpha < 0.003) discard;

  gl_FragColor = vec4(color*alpha, alpha);
}
