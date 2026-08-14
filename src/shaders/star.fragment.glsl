uniform vec3 uColor;
uniform float uOpacity;

varying float vTwinkle;

void main() {
  // Point sprites are square. Round it off and feather the edge, otherwise the
  // sky is a field of tiny rectangles.
  float d = length(gl_PointCoord - 0.5);

  if (d > 0.5) discard;

  gl_FragColor = vec4(uColor, uOpacity*vTwinkle*smoothstep(0.5, 0.0, d));
}
