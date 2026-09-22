# FIELD — spatial interaction study

Run `npm install` then `npm run dev -- --port 5178`. Build with `npm run build`.

A local Three.js concept inspired by the supplied Lusion screenshots and Igloo / Hashgraph references. All geometry is generated in code; no image assets or external site code are reused.

- Click the scene to create matter (bounded to 54 objects), drag horizontally to rotate.
- Scroll through the sticky scene: framed object field → expanding viewport → particle world.
- Change color and switch between aggregation, orbit and spread.
- Pause ambient animation; reduced-motion preference starts paused.

This is an interaction prototype, not a production website. Objects float and overlap; there is no rigid-body collision simulation. The transition is a continuous contraction of solids with an overlapping particle reveal, not a mesh-to-particle dissolve. Google Fonts has system fallbacks. WebGL is required.

## Scroll stability

The sticky stage and WebGL canvas have stable dimensions. Scroll expands a clip-path instead of changing padding or drawing-buffer size. Actual viewport resizes are queued and applied before rendering in the same frame. Progress is recalculated from current layout each frame; smoothing is time-based. Solids remain in front of the camera and shrink continuously as particles brighten, with no visibility cutoff. Morphing particles disable stale frustum culling. The stage uses stable viewport units for mobile browser chrome.
