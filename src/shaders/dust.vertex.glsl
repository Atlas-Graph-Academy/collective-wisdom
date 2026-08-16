// Packed: aVariation and aOpacity are bytes over [0, 1], aSize over
// [0, uSizeRange].
attribute float aVariation;
attribute float aSize;
attribute float aOpacity;

uniform float uPixelRatio;
uniform float uScale;
uniform float uMaxSize;
uniform float uSizeRange;
uniform vec3 uNormal;

varying float vVariation;
varying float vOpacity;
varying float vFacing;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * mvPosition;

  float size = aSize*uSizeRange*uPixelRatio*uScale*(4.0 / max(0.001, -mvPosition.z));

  gl_PointSize = min(size, uMaxSize*uPixelRatio);

  // How face-on the disc is from here. Dust is drawn as a stack of sprites in
  // a thin sheet: seen face-on they barely overlap, seen obliquely dozens of
  // them line up along the view ray and the lane goes to black. Physically
  // that thickening is real (path length grows as 1/cos), but the sprite
  // stack overshoots it badly, so the fragment stage leans against it.
  vec3 normal = normalize((modelViewMatrix * vec4(uNormal, 0.0)).xyz);
  vec3 toCamera = normalize(-mvPosition.xyz);

  vFacing = abs(dot(normal, toCamera));

  vVariation = aVariation;
  vOpacity = aOpacity;
}
