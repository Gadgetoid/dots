// Rendering abstraction.
//
// The game never touches a drawing context. It calls these high-level primitives
// in view space (the fixed 600x800 field from config.js), which is exactly what a
// GPU backend wants. WebGLRenderer (glrenderer.js) is the only implementation; to
// add another, implement everything here and swap it in `main.js`. test/view.test.js
// records against this same list, so a call the view makes that a backend has not
// implemented is caught there.
//
// Besides the methods, a backend carries a `canvas` and three values the view sets
// before each frame: `brightness` multiplies the whole composite, `glowIntensity` is
// how much of the blurred glow layer is added back, and `vignette` darkens the corners.
//
// Options bags use these keys:
//   color     CSS colour string
//   alpha     0..1, multiplied into the colour's own alpha
//   glow      0 = matte, >0 adds the primitive to the glow layer at that strength
//   width     line thickness, or border thickness for a stroked panel
//   wobble    { amount, axis } jelly deformation, discs only
//   sheen     0..1 highlight on a disc, so it reads as a bead
//   shape     { sides, turn, strength } bends a disc toward a polygon; see DOT_SHAPES
//   radius    corner radius, panels only
//   fill      / stroke: which of the two a panel draws
//   frost     panels only: draw as frosted glass over a blurred copy of the frame
//   falloff   how hard a point's light falls off toward its edge
//   taper     [head, tail] alpha along a ribbon's length
//   size      / align / baseline / bold: text
export class Renderer {
  // False while the backend cannot draw (e.g. a lost GPU context), so the loop can
  // skip the frame instead of issuing calls that would be discarded.
  get ready() {
    return true
  }
  beginFrame(_time) {} // start a frame; optional
  endFrame() {} // post-processing and present; optional
  // Everything from here goes over the finished frame rather than into it, which is
  // what lets a panel frost itself against a blurred copy of it. `hidesScene` says the
  // overlay covers the frame completely, so the scene's own glow must not bleed
  // through it.
  beginOverlay(_opts) {}
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
  // A run of dots as one smooth body: the chain. Points carry a `grow` for how far
  // the link into each has reached, and the backend fillets the joins and the corners.
  blobChain(_points, _opts) {
    throw new Error("not implemented")
  }
  // A thick line through `points`, which the spark streaks are drawn with. `taper`
  // fades the alpha along its length.
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
  // How wide a run of text will be, so a caller can lay out around it. `bold` matters: a
  // face need not be monospaced, and a bold advance is not its regular one.
  measureText(_str, _size, _bold) {
    return 0
  }
  // Draw text in this font stack from here on. Called by the view every frame with what the
  // settings ask for, so the same stack twice has to cost nothing.
  setFont(_stack) {}
  // Confine what follows to a rectangle in view space, until clipOff. What the
  // scrolling level picker draws inside.
  clip(_x, _y, _w, _h) {}
  clipOff() {}
  // The letterboxed rectangle the field is drawn into, in CSS pixels, set by the view
  // on a resize.
  setContentRect(_x, _y, _w, _h, _dpr) {}
}
