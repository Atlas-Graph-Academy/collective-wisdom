/**
 * Where a point of the field is right now, given its four resting shapes and
 * the state of the story. Shared by the instances and the lines between them,
 * so a line's endpoints always land exactly on the grains it joins.
 *
 * `progress` runs 0..4: galaxy → dust → (dust, resonating) → organism → brain.
 * `lit` is 1 once the wave has reached this point.
 */

vec3 fieldMorph(vec3 galaxy, vec3 dust, vec3 organism, vec3 brain, float progress) {
  float p = clamp(progress, 0.0, 4.0);

  if (p < 1.0) {
    return mix(galaxy, dust, smoothstep(0.0, 1.0, p));
  }

  if (p < 2.0) {
    // The wave passes; the grains stay where they are.
    return dust;
  }

  if (p < 3.0) {
    return mix(dust, organism, smoothstep(0.0, 1.0, p - 2.0));
  }

  return mix(organism, brain, smoothstep(0.0, 1.0, p - 3.0));
}

/**
 * A two-octave sine flow field. Not divergence-free the way real curl noise is,
 * but it swirls, its octaves beat against each other so it never visibly loops,
 * and it costs a handful of sines per vertex.
 */
vec3 fieldFlow(vec3 p, float t) {
  vec3 q = p*1.5;

  return vec3(
    sin(q.y + t*0.90) + 0.5*sin(q.z*2.1 - t*1.30),
    sin(q.z + t*1.10) + 0.5*sin(q.x*1.9 + t*0.70),
    sin(q.x + t*0.80) + 0.5*sin(q.y*2.3 - t*1.10)
  );
}

vec3 fieldPosition(
  vec3 galaxy, vec3 dust, vec3 organism, vec3 brain,
  float progress, float time,
  float flow, float breath,
  float jitter, float sync, float phase, float lit
) {
  vec3 target = fieldMorph(galaxy, dust, organism, brain, progress);

  // Nothing is ever allowed to sit still.
  target += fieldFlow(target, time*0.35)*flow;
  target *= 1.0 + sin(time*0.45)*breath;

  // Before the light reaches it, a grain shakes on its own: fast, incoherent,
  // its phase its own. After, it moves with everyone else — one slow radial
  // pulse the whole field shares. Chaos into rhythm is the whole transition.
  vec3 chaos = vec3(
    sin(time*11.0 + phase*37.0),
    sin(time*13.0 + phase*59.0),
    sin(time*9.0 + phase*23.0)
  );

  vec3 radial = normalize(target + vec3(1e-4));

  target += chaos*jitter*(1.0 - lit);
  target += radial*sin(time*4.0)*sync*lit;

  return target;
}

#pragma glslify: export(fieldPosition)
