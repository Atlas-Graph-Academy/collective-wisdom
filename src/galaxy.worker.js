/**
 * Off-thread galaxy generation. The generator is pure JS on typed arrays, so
 * it moves here wholesale; the buffers come back as transferables, so nothing
 * is copied. The main thread's only cost is creating the geometry.
 */
import { generateGalaxy } from './galaxy'

self.onmessage = e => {
  const { count, dustCount, radius } = e.data
  const { field, dust, timing } = generateGalaxy(count, dustCount, radius)

  self.postMessage(
    { field, dust, timing },
    [
      field.positions.buffer, field.colors.buffer, field.sizes.buffer,
      dust.positions.buffer, dust.variation.buffer, dust.sizes.buffer, dust.opacities.buffer
    ]
  )
}
