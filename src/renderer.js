// Rendering abstraction.
//
// The game never touches a drawing context. It calls these high-level primitives
// in view space (the fixed 600x800 field from config.js), which is exactly what a
// GPU backend wants. WebGLRenderer (glrenderer.js) is the only implementation; to
// add another, implement this same interface and swap it in `main.js`.
//
// Options bags use these keys:
//   color     CSS colour string
//   alpha     0..1, multiplied into the colour's own alpha
//   glow      0 = matte, >0 adds the primitive to the glow layer at that strength
//   width     line thickness, or border thickness for a stroked panel
//   wobble    { amount, axis } jelly deformation, discs only
//   sheen     0..1 highlight on a disc, so it reads as a bead
//   radius    corner radius, panels only
//   fill      / stroke: which of the two a panel draws
//   size      / align / baseline / bold: text
export class Renderer {
  // False while the backend cannot draw (e.g. a lost GPU context), so the loop can
  // skip the frame instead of issuing calls that would be discarded.
  get ready() {
    return true
  }
  beginFrame(_time) {} // start a frame; optional
  endFrame() {} // post-processing and present; optional
  clearFrame(_color) {
    throw new Error("not implemented")
  }
  // A filled circle, optionally deformed. The board is made of these.
  disc(_x, _y, _r, _opts) {
    throw new Error("not implemented")
  }
  // An outlined circle: the cursor, and the shockwave a pop throws.
  ring(_x, _y, _r, _opts) {
    throw new Error("not implemented")
  }
  // A smooth thick line through `points`, which the chain and the spark streaks
  // are drawn with. `taper` fades the alpha along its length.
  ribbon(_points, _opts) {
    throw new Error("not implemented")
  }
  // Soft round light, for particles and haloes. Additive whether or not it glows.
  point(_x, _y, _size, _opts) {
    throw new Error("not implemented")
  }
  // A rounded rectangle, filled or outlined.
  panel(_x, _y, _w, _h, _opts) {
    throw new Error("not implemented")
  }
  text(_str, _x, _y, _opts) {
    throw new Error("not implemented")
  }
  // How wide a run of text will be, so a caller can lay out around it.
  measureText(_str, _size) {
    return 0
  }
}
