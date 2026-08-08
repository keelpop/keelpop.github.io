# Reference art

Photographic reference for the cat's proportions, and the source plates for the
planned textured-parts renderer.

Generated with Google Nano Banana Pro (`nano_banana_pro`, 4K) from prompts asking
for an exact lateral side profile on a flat white background with no cast shadow,
so the cat can be cut into parts and driven by the existing skeleton.

Expected files:

| file | contents |
| --- | --- |
| `stand.png` | standing, exact side profile, all four legs separable |
| `sit.png` | sitting upright, side profile |
| `loaf.png` | lying in a loaf, side profile |
| `head-turns.png` | three views of the same head: profile, 3/4, frontal |

`src/renderer/rig.js` and `src/renderer/draw.js` carry measurements taken off
these plates — the back line, belly and chest depths, head length, and the
positions of the eye and nose within the skull. If the plates are replaced,
re-measure rather than nudging the numbers by eye.
