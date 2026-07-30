// WebGL2 backend for the Renderer contract (see renderer.js).
//
// Everything is 2D and orthographic: view coordinates go straight to NDC, so a
// dot at (300, 400) is at the middle of the field whatever the canvas is doing.
// Shapes are distance fields cut out of quads and antialiased in the fragment
// shader, which is what gives smooth edges without a multisampled target.
//
// A frame is drawn into two offscreen targets at once. The scene target takes
// everything; the glow target takes only the primitives the view marks as
// glowing, and its own copy of them is scaled by how much they glow. The glow
// target is then blurred and added over the scene in the composite pass, so the
// bloom is exactly what the game asked to shine rather than whatever happened to
// be bright - which is what lets the light theme have a glowing chain without the
// white background blooming.
//
// Draw calls are recorded into one vertex buffer per layer with a command list
// alongside, so painter order is preserved and the whole layer uploads once.
//
// The GLSL for every pass lives in shaders.js.

import { Renderer } from "./renderer.js"
import { FONTS } from "./fonts.js"
import { VIEW_W, VIEW_H, CONFIG } from "./config.js"
import { clamp } from "./math.js"
import {
  DISC_VS,
  DISC_FS,
  CHAIN_VS,
  CHAIN_FS,
  RIBBON_VS,
  RIBBON_FS,
  SPRITE_VS,
  SPRITE_FS,
  PANEL_VS,
  PANEL_FS,
  FROST_FS,
  TEXT_VS,
  TEXT_FS,
  FSTRI_VS,
  BLUR_FS,
  BLIT_FS,
  COMPOSITE_FS,
} from "./shaders.js"

// Internal resolution, at twice the view so the field is oversampled a little
// before it is scaled to the canvas.
const SCENE_W = VIEW_W * 2
const SCENE_H = VIEW_H * 2

// A dot with no shape of its own: a circle, which is what the shader draws when it is
// asked for no sides.
const NO_FORM = [0, 0, 0, 0]

// How far a ribbon joint may be pushed out where two segments meet at an angle.
// The chain is a smoothed curve so this is only ever reached by a spark streak.
const MITER_LIMIT = 2.4

// ---- CSS colour parsing (cached via a scratch 2D context) -----------------
// Each miss costs a getImageData readback, so callers should pass a fixed colour
// plus an `alpha` option instead of interpolating a value into an rgba() string.
const COLOUR_CACHE_MAX = 2048
const colourCache = new Map()
let colourCtx = null
function parseColour(str) {
  if (str == null) {
    return [1, 1, 1, 1]
  }
  let hit = colourCache.get(str)
  if (hit) {
    return hit
  }
  if (!colourCtx) {
    colourCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  }
  if (colourCache.size >= COLOUR_CACHE_MAX) {
    colourCache.clear()
  }
  colourCtx.clearRect(0, 0, 1, 1)
  colourCtx.fillStyle = "#000"
  colourCtx.fillStyle = str
  colourCtx.fillRect(0, 0, 1, 1)
  const d = colourCtx.getImageData(0, 0, 1, 1).data
  hit = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]
  colourCache.set(str, hit)
  return hit
}

// ---- shader helpers -------------------------------------------------------
function compile(gl, type, src) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error("shader compile: " + gl.getShaderInfoLog(shader) + "\n" + src)
  }
  return shader
}
function program(gl, vs, fs) {
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("program link: " + gl.getProgramInfoLog(prog))
  }
  return prog
}

// ---- font atlas -----------------------------------------------------------
// Every printable ASCII character, rasterised once into a grid of fixed cells, twice over
// for the two weights. A cell is as wide as the widest character the face has, and each
// character is drawn at the same offset inside its own cell - so a cell holds the glyph's
// ink wherever its own bearings put it, and the quad that samples the cell reproduces that.
//
// What is not fixed is how far the pen moves afterwards. A proportional face advances by a
// different amount per character, so the advances are measured here and kept: a face where
// an `i` is a third the width of a `W` cannot be laid out by counting characters. See
// measureText and text.
const ATLAS_FONT = 44
const FIRST_CODE = 32
const LAST_CODE = 126
const GLYPH_COUNT = LAST_CODE - FIRST_CODE + 1
const ATLAS_COLS = 16
// Room inside a cell for the ink to sit where the face puts it, on both sides.
const CELL_PAD = 6

function buildAtlas(stack) {
  const measure = document.createElement("canvas").getContext("2d")
  const weights = [`${ATLAS_FONT}px ${stack}`, `bold ${ATLAS_FONT}px ${stack}`]
  // One advance per character per weight, and the widest of the lot decides the cell.
  const advances = weights.map((font) => {
    measure.font = font
    const row = new Float32Array(GLYPH_COUNT)
    for (let i = 0; i < GLYPH_COUNT; i++) {
      row[i] = measure.measureText(String.fromCharCode(FIRST_CODE + i)).width
    }
    return row
  })
  const widest = Math.max(...advances.flatMap((row) => [...row]))
  const cellW = Math.ceil(widest) + CELL_PAD
  const cellH = ATLAS_FONT + 18
  const baseline = ATLAS_FONT + 4
  const rowsPerWeight = Math.ceil(GLYPH_COUNT / ATLAS_COLS)
  const canvas = document.createElement("canvas")
  canvas.width = ATLAS_COLS * cellW
  canvas.height = rowsPerWeight * 2 * cellH // regular then bold
  const ctx = canvas.getContext("2d")
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  ctx.fillStyle = "#fff"
  for (let weight = 0; weight < 2; weight++) {
    ctx.font = weights[weight]
    for (let i = 0; i < GLYPH_COUNT; i++) {
      const col = i % ATLAS_COLS
      const row = Math.floor(i / ATLAS_COLS) + weight * rowsPerWeight
      ctx.fillText(String.fromCharCode(FIRST_CODE + i), col * cellW + 3, row * cellH + baseline)
    }
  }
  return { canvas, cellW, cellH, baseline, advances, cols: ATLAS_COLS, rowsPerWeight, stack }
}

// Vertex layout per pipeline: floats per vertex, the [location, size] attribute
// list, and whether the pipeline draws over what is behind it or adds to it.
const LAYOUTS = {
  chain: {
    stride: 22,
    attrs: [
      [0, 2],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
    ],
    blend: "over",
    // One quad per link, and neighbouring quads overlap. Over the scene that costs
    // nothing, since both draw the same opaque colour - but the glow layer adds what
    // it is given, and two copies of the same light is twice as much of it: the chain
    // came out with a bright band at every join. Taking the brightest value instead is
    // exact here, because every quad of a chain is drawing one colour.
    glowBlend: "max",
  },
  disc: {
    stride: 16,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 4],
      [3, 4],
      [4, 4],
    ],
    blend: "over",
  },
  ribbon: {
    stride: 8,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 4],
    ],
    blend: "over",
  },
  sprite: {
    stride: 9,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 1],
      [3, 4],
    ],
    blend: "add",
  },
  panel: {
    stride: 12,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 4],
      [3, 4],
    ],
    blend: "over",
  },
  // The same vertices as a panel; only the fragment differs, so a frosted panel is
  // built by the same code and drawn by a different program.
  frost: {
    stride: 12,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 4],
      [3, 4],
    ],
    blend: "over",
  },
  text: {
    stride: 8,
    attrs: [
      [0, 2],
      [1, 2],
      [2, 4],
    ],
    blend: "over",
  },
}

// ---------------------------------------------------------------------------
export class WebGLRenderer extends Renderer {
  // Returns null when this backend is unavailable, so the caller can say so
  // rather than leaving a blank canvas.
  static create(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
    })
    if (!gl) {
      return null
    }
    try {
      return new WebGLRenderer(canvas, gl)
    } catch (error) {
      console.warn("WebGL2 backend unavailable:", error)
      return null
    }
  }

  constructor(canvas, gl) {
    super()
    this.canvas = canvas
    this.gl = gl
    // The face the atlas is rasterised from, until the view says otherwise. See setFont.
    this.fontStack = FONTS[0].stack
    this.time = 0
    this.brightness = 1
    this.glowIntensity = CONFIG.BLOOM_INTENSITY
    this.vignette = 0
    this.clearColour = [0, 0, 0, 1]
    this.contextLost = false

    // One vertex scratch buffer per layer, with the draw calls recorded against
    // it. Builders write straight in; nothing reaches the GPU until endFrame.
    this.layers = {
      scene: this.#freshLayer(),
      // Drawn after the scene has been finished and blurred, which is what lets a
      // frosted panel sample what is behind it.
      overlay: this.#freshLayer(),
      glow: this.#freshLayer(),
    }
    // Which of the two the primitives are being recorded into.
    this.target = "scene"

    this.#buildGpuState()

    // A driver reset, a GPU switch or a long spell in a background tab can take
    // the context away, and every object built from it with it. Preventing the
    // default on the loss event is what lets the browser hand back a restored
    // context; everything is then rebuilt from scratch.
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault()
      this.contextLost = true
    })
    canvas.addEventListener("webglcontextrestored", () => {
      this.#buildGpuState()
      this.contextLost = false
    })

    // The atlas is rasterised from a system monospace stack, which needs no
    // loading, but a font can still settle after first paint. Rebuild once when
    // it does, so glyph metrics match what the page ended up with.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!this.contextLost) {
          this.#initAtlas()
        }
      })
    }
  }

  #freshLayer() {
    return { data: new Float32Array(1 << 14), count: 0, commands: [], prog: null, start: 0 }
  }

  // (Re)create everything owned by the GL context. Safe to call again after the
  // context is restored, when all previous handles are dead.
  #buildGpuState() {
    const gl = this.gl
    this.uniformCache = new Map()
    this.vboCapacity = 0
    // How many attribute arrays are enabled on the vertex array below, which holds that
    // state across every replay and every frame. A fresh one has none.
    this.enabledAttrs = 0
    // Every handle from the old context is dead, so nothing here is deleted; it is dropped.
    this.atlasTex = null
    this.progs = {
      disc: program(gl, DISC_VS, DISC_FS),
      chain: program(gl, CHAIN_VS, CHAIN_FS),
      ribbon: program(gl, RIBBON_VS, RIBBON_FS),
      sprite: program(gl, SPRITE_VS, SPRITE_FS),
      panel: program(gl, PANEL_VS, PANEL_FS),
      frost: program(gl, PANEL_VS, FROST_FS),
      text: program(gl, TEXT_VS, TEXT_FS),
      blur: program(gl, FSTRI_VS, BLUR_FS),
      blit: program(gl, FSTRI_VS, BLIT_FS),
      composite: program(gl, FSTRI_VS, COMPOSITE_FS),
    }
    this.vao = gl.createVertexArray()
    this.vbo = gl.createBuffer()
    this.emptyVao = gl.createVertexArray()
    // RGBA16F lets a glow accumulate past 1.0, so several overlapping haloes
    // bloom together rather than clipping. Without it the targets clamp, which
    // still reads correctly, only flatter.
    this.floatTargets = !!gl.getExtension("EXT_color_buffer_float")
    this.scene = this.#makeTarget(SCENE_W, SCENE_H)
    this.glow = this.#makeTarget(SCENE_W >> 1, SCENE_H >> 1)
    this.blurA = this.#makeTarget(SCENE_W >> 2, SCENE_H >> 2)
    this.blurB = this.#makeTarget(SCENE_W >> 2, SCENE_H >> 2)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#initAtlas()
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
  }

  get ready() {
    return !this.contextLost
  }

  #makeTarget(w, h) {
    const gl = this.gl
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (this.floatTargets) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`incomplete framebuffer at ${w}x${h}`)
    }
    return { tex, fbo, w, h }
  }

  // Draw text in this font stack from here on. A rebuild is a canvas rasterise and one
  // texture upload, so it is cheap enough to do the moment a face is chosen - but it is
  // asked for every frame, so the same stack twice has to cost nothing.
  setFont(stack) {
    if (!stack || stack === this.fontStack) {
      return
    }
    this.fontStack = stack
    if (!this.contextLost) {
      this.#initAtlas()
    }
  }

  #initAtlas() {
    const gl = this.gl
    // Called again when a face is chosen or a font settles, so the atlas this replaces goes
    // with it.
    if (this.atlasTex) {
      gl.deleteTexture(this.atlasTex)
    }
    const atlas = buildAtlas(this.fontStack)
    this.atlas = atlas
    const ctx = atlas.canvas.getContext("2d")
    const image = ctx.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height)
    const coverage = new Uint8Array(atlas.canvas.width * atlas.canvas.height)
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = image.data[i * 4 + 3] // the canvas alpha is the glyph coverage
    }
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      atlas.canvas.width,
      atlas.canvas.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      coverage,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.atlasTex = tex
  }

  // ---- frame lifecycle ----------------------------------------------------
  beginFrame(time) {
    this.time = time
    this.target = "scene"
    for (const layer of Object.values(this.layers)) {
      layer.count = 0
      layer.commands.length = 0
      layer.prog = null
      layer.start = 0
    }
  }

  clearFrame(color) {
    this.clearColour = parseColour(color)
  }

  // Everything from here goes over a finished frame rather than into it. Called by the
  // view before it draws a menu, so a frosted panel has something blurred to show.
  //
  // `hidesScene` says the overlay covers the frame completely. The glow layer is added
  // over everything in the composite pass, so without this the light from something in
  // the scene - the score floating off a spent chain, say - would bleed through an opaque
  // menu as a smudge with nothing under it. Where the menu is glass the scene shows
  // through anyway and its light should come with it.
  beginOverlay({ hidesScene = false } = {}) {
    this.target = "overlay"
    if (hidesScene) {
      const glow = this.layers.glow
      glow.count = 0
      glow.commands.length = 0
      glow.prog = null
      glow.start = 0
    }
  }

  endFrame() {
    const gl = this.gl
    this.#closeCommand(this.layers.scene)
    this.#closeCommand(this.layers.overlay)
    this.#closeCommand(this.layers.glow)

    const c = this.clearColour
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo)
    gl.viewport(0, 0, this.scene.w, this.scene.h)
    gl.clearColor(c[0], c[1], c[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.#replay(this.layers.scene, false, this.scene)

    // Anything drawn over the finished frame, with a blurred copy of that frame ready
    // for whatever wants to frost itself against it.
    if (this.layers.overlay.commands.length > 0) {
      this.#blurBehind()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo)
      gl.viewport(0, 0, this.scene.w, this.scene.h)
      this.#replay(this.layers.overlay, false, this.scene)
    }

    // The glow layer starts from nothing: it is light to be added, so anywhere
    // the view asked for none must contribute none.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.glow.fbo)
    gl.viewport(0, 0, this.glow.w, this.glow.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.#replay(this.layers.glow, true, this.glow)

    this.#blurGlow()
    this.#composite()
  }

  // ---- batching -----------------------------------------------------------
  #closeCommand(layer) {
    if (layer.prog && layer.count > layer.start) {
      layer.commands.push({
        prog: layer.prog,
        offset: layer.start,
        floats: layer.count - layer.start,
      })
    }
    layer.prog = null
    layer.start = layer.count
  }

  #use(layer, progName) {
    if (layer.prog === progName) {
      return
    }
    this.#closeCommand(layer)
    layer.prog = progName
  }

  // Make room for `floats` more values, doubling the scratch buffer when it runs
  // out. Builders write straight into layer.data at layer.count.
  #reserve(layer, floats) {
    const need = layer.count + floats
    if (need <= layer.data.length) {
      return
    }
    let size = layer.data.length || 4096
    while (size < need) {
      size *= 2
    }
    const grown = new Float32Array(size)
    grown.set(layer.data.subarray(0, layer.count))
    layer.data = grown
  }

  // Record one primitive. `build(layer, colour)` writes its vertices; it runs
  // once for the scene and again into the glow layer when the primitive glows,
  // with its colour scaled by how much.
  #emit(progName, colour, glow, build) {
    const scene = this.layers[this.target]
    this.#use(scene, progName)
    build(scene, colour)
    if (glow > 0) {
      const glowLayer = this.layers.glow
      this.#use(glowLayer, progName)
      build(glowLayer, [colour[0] * glow, colour[1] * glow, colour[2] * glow, colour[3]])
    }
  }

  // Upload one layer and issue its recorded draws in order. The glow layer adds
  // whatever it holds, whichever pipeline drew it: it is light, not shapes.
  #replay(layer, additive, target) {
    if (layer.commands.length === 0) {
      return
    }
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    if (layer.data.byteLength > this.vboCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, layer.data.byteLength, gl.STREAM_DRAW)
      this.vboCapacity = layer.data.byteLength
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, layer.data, 0, layer.count)
    let boundProg = null
    gl.disable(gl.SCISSOR_TEST)
    for (const command of layer.commands) {
      // A scroll region: everything recorded after it is confined to the rectangle, until
      // another one turns it off. Recorded in the list rather than applied when it was asked
      // for, because the layers are replayed long after that.
      if (command.clip !== undefined) {
        this.#applyClip(command.clip, target)
        continue
      }
      const layout = LAYOUTS[command.prog]
      const prog = this.progs[command.prog]
      if (prog !== boundProg) {
        gl.useProgram(prog)
        gl.uniform2f(this.#uniform(prog, "uViewport"), VIEW_W, VIEW_H)
        if (command.prog === "text") {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
          gl.uniform1i(this.#uniform(prog, "uAtlas"), 0)
        }
        if (command.prog === "frost") {
          this.#bindTex(prog, "uBehind", this.blurA.tex, 0)
          gl.uniform2f(this.#uniform(prog, "uSize"), this.scene.w, this.scene.h)
        }
        boundProg = prog
      }
      if (additive && layout.glowBlend === "max") {
        gl.blendEquation(gl.MAX)
        gl.blendFunc(gl.ONE, gl.ONE) // factors are ignored under MAX
      } else {
        gl.blendEquation(gl.FUNC_ADD)
        if (additive || layout.blend === "add") {
          gl.blendFunc(gl.ONE, gl.ONE)
        } else {
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        }
      }
      const stride = layout.stride * 4
      let offset = command.offset * 4
      for (const [location, size] of layout.attrs) {
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset)
        offset += size * 4
      }
      // And off with whatever a wider pipeline left enabled. An array the program does not
      // read is still an array the draw walks, at the stride and offset it was last given:
      // the chain's stride is 88 bytes against text's 32, so a long run of glyphs drawn
      // after a chain addresses well past the vertices it owns. Every layout numbers its
      // attributes from nought without gaps, so the count is how many are wanted.
      for (let location = layout.attrs.length; location < this.enabledAttrs; location++) {
        gl.disableVertexAttribArray(location)
      }
      this.enabledAttrs = layout.attrs.length
      gl.drawArrays(gl.TRIANGLES, 0, command.floats / layout.stride)
    }
    // Both are global state that the blur and composite passes after this do not set for
    // themselves: MAX is per-pipeline, and a clip belongs to the layer that asked for it.
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(null)
  }

  // Uniform locations never change once a program is linked, and looking them up
  // by name is a driver-side string lookup, so cache them.
  #uniform(prog, name) {
    let byName = this.uniformCache.get(prog)
    if (!byName) {
      byName = new Map()
      this.uniformCache.set(prog, byName)
    }
    let location = byName.get(name)
    if (location === undefined) {
      location = this.gl.getUniformLocation(prog, name)
      byName.set(name, location)
    }
    return location
  }

  #colour(opts) {
    const c = parseColour(opts.color)
    return [c[0], c[1], c[2], (opts.alpha ?? 1) * c[3]]
  }

  // ---- Renderer contract --------------------------------------------------
  disc(x, y, r, opts = {}) {
    const colour = this.#colour(opts)
    const wobble = opts.wobble
    // The wobble stretches the shape, so the quad has to be big enough to hold the
    // deformed dot or the edge would be clipped square.
    //
    // A wobble that is not a number is treated as none, in both halves. clamp lets a NaN
    // straight through - neither comparison in it is true of one - and from there it
    // reaches the vertex positions and the dot disappears entirely. A dot drawn without
    // its wobble is a far smaller wrong than a dot not drawn.
    const amount = Number.isFinite(wobble?.amount)
      ? clamp(wobble.amount, -CONFIG.WOBBLE_MAX, CONFIG.WOBBLE_MAX)
      : 0
    const axis = Number.isFinite(wobble?.axis) ? wobble.axis : 0
    const extent = r * (1 + Math.abs(amount) + 0.02)
    const shape = [amount, axis, 0, opts.sheen ?? 0]
    const form = this.#form(opts.shape)
    this.#emit("disc", colour, opts.glow || 0, (layer, col) =>
      this.#quad(layer, x, y, extent, (write, dx, dy) => {
        // The uv runs -1..1 over the dot itself, so the shader's unit circle is
        // the dot however much padding the quad carries for the wobble.
        write(dx * (extent / r), dy * (extent / r), shape, col, form)
      }),
    )
  }

  // The chain as one smooth body. `points` are the dot centres in order, each with a
  // `grow` of 0..1 for how far the link into it has reached out from the one before -
  // which is what makes a chain extend toward a dot rather than snap to it.
  //
  // One quad per link, sized to hold the link plus everything that can bulge outside
  // it. The shader does the rest; see CHAIN_FS.
  blobChain(points, opts = {}) {
    if (points.length < 2) {
      return
    }
    const colour = this.#colour(opts)
    const dotRadius = opts.radius ?? 10
    const cordRadius = opts.cord ?? dotRadius
    const smooth = opts.smooth ?? dotRadius * 0.5
    const pad = dotRadius + smooth + 2
    // Where a link actually reaches, which is short of its dot while it is growing.
    const reach = (index) => {
      const to = points[index]
      const from = points[index - 1]
      const grow = to.grow ?? 1
      return { x: from.x + (to.x - from.x) * grow, y: from.y + (to.y - from.y) * grow }
    }
    // Does the chain turn between these two links? Only a turn has a notch on the
    // inside of it to soften; two links in a line are already one straight rod, and
    // filleting them would swell the run.
    const turns = (from, at, to) =>
      Math.abs((at.x - from.x) * (to.y - at.y) - (at.y - from.y) * (to.x - at.x)) > 1e-4
    // Which way is the inside of a turn, as a unit vector from the corner. Coming in
    // along u and leaving along v, the notch is on the side of v - u: the shader uses
    // this to keep the fillet off the outside of the corner, where the outline is the
    // corner dot's own circle and is already right.
    const bisector = (from, at, to) => {
      const inX = at.x - from.x
      const inY = at.y - from.y
      const outX = to.x - at.x
      const outY = to.y - at.y
      const inLength = Math.hypot(inX, inY) || 1
      const outLength = Math.hypot(outX, outY) || 1
      const x = outX / outLength - inX / inLength
      const y = outY / outLength - inY / inLength
      const length = Math.hypot(x, y) || 1
      return { x: x / length, y: y / length }
    }
    this.#emit("chain", colour, opts.glow || 0, (layer, col) => {
      this.#reserve(layer, (points.length - 1) * 6 * 22)
      const data = layer.data
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = reach(i)
        // The dots either side of this link, so a corner is smoothed by both of the
        // links that turn through it. At either end of the chain the neighbour is the
        // link's own dot, which is a rod of no length and costs nothing.
        const before = i >= 2 ? points[i - 2] : a
        const after = i + 1 < points.length ? reach(i + 1) : b
        const turnsIn = i >= 2 && turns(before, a, b)
        const turnsOut = i + 1 < points.length && turns(a, b, after)
        const filletIn = turnsIn ? smooth : 0
        const filletOut = turnsOut ? smooth : 0
        const insideIn = turnsIn ? bisector(before, a, b) : { x: 0, y: 0 }
        const insideOut = turnsOut ? bisector(a, b, after) : { x: 0, y: 0 }
        const minX = Math.min(a.x, b.x) - pad
        const maxX = Math.max(a.x, b.x) + pad
        const minY = Math.min(a.y, b.y) - pad
        const maxY = Math.max(a.y, b.y) + pad
        const corner = (dx, dy) => {
          let index = layer.count
          data[index++] = dx < 0 ? minX : maxX
          data[index++] = dy < 0 ? minY : maxY
          data[index++] = a.x
          data[index++] = a.y
          data[index++] = b.x
          data[index++] = b.y
          data[index++] = before.x
          data[index++] = before.y
          data[index++] = after.x
          data[index++] = after.y
          data[index++] = dotRadius
          data[index++] = cordRadius
          data[index++] = filletIn
          data[index++] = filletOut
          data[index++] = col[0]
          data[index++] = col[1]
          data[index++] = col[2]
          data[index++] = col[3]
          data[index++] = insideIn.x
          data[index++] = insideIn.y
          data[index++] = insideOut.x
          data[index++] = insideOut.y
          layer.count = index
        }
        this.#corners(corner)
      }
    })
  }

  // Confine drawing to a rectangle in view space, or turn that off with clipOff(). Used by
  // the scrolling level picker: without it a grid taller than its window draws over the
  // heading and the way out.
  clip(x, y, w, h) {
    this.#pushClip({ x, y, w, h })
  }

  clipOff() {
    this.#pushClip(null)
  }

  #pushClip(rect) {
    // The glow layer gets it too, or the light from something scrolled out of sight is still
    // added over whatever is there.
    for (const layer of [this.layers[this.target], this.layers.glow]) {
      this.#closeCommand(layer)
      layer.commands.push({ clip: rect })
    }
  }

  #applyClip(rect, target) {
    const gl = this.gl
    if (!rect) {
      gl.disable(gl.SCISSOR_TEST)
      return
    }
    const scaleX = target.w / VIEW_W
    const scaleY = target.h / VIEW_H
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(
      Math.round(rect.x * scaleX),
      // The scissor origin is the bottom left of the target, and the view's is the top left.
      Math.round(target.h - (rect.y + rect.h) * scaleY),
      Math.max(0, Math.round(rect.w * scaleX)),
      Math.max(0, Math.round(rect.h * scaleY)),
    )
  }

  // A dot's shape, as the shader wants it: how many sides, how far round they are turned,
  // and how far to bend the circle toward them.
  //
  // The bend is divided by how much difference that many sides makes at all, so every shape
  // dents its edges in by the same fraction of the radius: a triangle moves its edges far
  // further than a hexagon does for the same mix, and a board where the triangles shout and
  // the hexagons whisper is a board where only some of the shapes do their job.
  #form(shape) {
    if (!shape || !(shape.sides >= 3)) {
      return [0, 0, 0, 0]
    }
    const strength = shape.strength ?? CONFIG.SHAPE_STRENGTH
    const half = Math.PI / shape.sides
    const reach = 1 - Math.cos(half)
    return [shape.sides, shape.turn || 0, clamp(strength / reach, 0, 1), 0]
  }

  ring(x, y, r, opts = {}) {
    const colour = this.#colour(opts)
    const width = opts.width ?? 2
    // The border is measured in the shader's quad units, where 1 is the radius.
    const halfBorder = Math.max(width / 2 / r, 0.004)
    const extent = r * (1 + halfBorder + 0.04)
    const shape = [0, 0, halfBorder, 0]
    this.#emit("disc", colour, opts.glow || 0, (layer, col) =>
      this.#quad(layer, x, y, extent, (write, dx, dy) => {
        write(dx * (extent / r), dy * (extent / r), shape, col)
      }),
    )
  }

  point(x, y, size, opts = {}) {
    const colour = this.#colour(opts)
    const extent = Math.max(size, 0.5)
    const falloff = opts.falloff ?? 1.8
    this.#emit("sprite", colour, opts.glow || 0, (layer, col) => {
      this.#reserve(layer, 6 * 9)
      const data = layer.data
      const corner = (dx, dy) => {
        let i = layer.count
        data[i++] = x + dx * extent
        data[i++] = y + dy * extent
        data[i++] = dx
        data[i++] = dy
        data[i++] = falloff
        data[i++] = col[0]
        data[i++] = col[1]
        data[i++] = col[2]
        data[i++] = col[3]
        layer.count = i
      }
      this.#corners(corner)
    })
  }

  ribbon(points, opts = {}) {
    if (points.length < 2) {
      return
    }
    const colour = this.#colour(opts)
    const half = (opts.width ?? 2) / 2
    // Alpha along the length: a chain holds one value, a spark streak fades from
    // its head to its tail.
    const taper = opts.taper || [1, 1]
    const normals = this.#ribbonNormals(points)
    this.#emit("ribbon", colour, opts.glow || 0, (layer, col) => {
      this.#reserve(layer, (points.length - 1) * 6 * 8)
      const data = layer.data
      const vertex = (index, side) => {
        const p = points[index]
        const n = normals[index]
        const fade = taper[0] + (taper[1] - taper[0]) * (index / (points.length - 1))
        let i = layer.count
        data[i++] = p.x + n.x * half * side * n.scale
        data[i++] = p.y + n.y * half * side * n.scale
        data[i++] = side
        data[i++] = half
        data[i++] = col[0]
        data[i++] = col[1]
        data[i++] = col[2]
        data[i++] = col[3] * fade
        layer.count = i
      }
      for (let i = 0; i < points.length - 1; i++) {
        vertex(i, -1)
        vertex(i + 1, -1)
        vertex(i + 1, 1)
        vertex(i, -1)
        vertex(i + 1, 1)
        vertex(i, 1)
      }
    })
  }

  // The outward normal at each point of a polyline, mitred where two segments
  // meet so the ribbon has no notch on the inside of a bend.
  #ribbonNormals(points) {
    const normals = []
    for (let i = 0; i < points.length; i++) {
      const before = points[Math.max(i - 1, 0)]
      const after = points[Math.min(i + 1, points.length - 1)]
      let dx = after.x - before.x
      let dy = after.y - before.y
      const length = Math.hypot(dx, dy) || 1
      dx /= length
      dy /= length
      // How much the joint has to be pushed out to keep the ribbon's width
      // through the bend, capped so a hairpin does not spike.
      let scale = 1
      if (i > 0 && i < points.length - 1) {
        const inX = points[i].x - before.x
        const inY = points[i].y - before.y
        const inLength = Math.hypot(inX, inY) || 1
        const cos = (inX / inLength) * dx + (inY / inLength) * dy
        scale = clamp(1 / Math.max(Math.sqrt((1 + cos) / 2), 1e-3), 1, MITER_LIMIT)
      }
      normals.push({ x: -dy, y: dx, scale })
    }
    return normals
  }

  // `frost` draws the panel as frosted glass instead of a flat fill: what is behind it
  // shows through blurred, tinted toward the fill by `alpha`. Only meaningful between
  // beginOverlay and the end of the frame, since that is when there is a blurred copy
  // of the frame to sample.
  panel(x, y, w, h, opts = {}) {
    const stroke = opts.stroke != null
    const colour = this.#colour({
      color: stroke ? opts.stroke : (opts.fill ?? opts.color),
      alpha: opts.alpha,
    })
    const halfW = w / 2
    const halfH = h / 2
    const radius = Math.min(opts.radius ?? 0, halfW, halfH)
    const border = stroke ? (opts.width ?? 2) / 2 : 0
    // A border straddles the edge, so the quad has to reach past it.
    const pad = border + 1
    const shape = [halfW, halfH, radius, border]
    const cx = x + halfW
    const cy = y + halfH
    this.#emit(opts.frost ? "frost" : "panel", colour, opts.glow || 0, (layer, col) => {
      this.#reserve(layer, 6 * 12)
      const data = layer.data
      const corner = (dx, dy) => {
        const localX = dx * (halfW + pad)
        const localY = dy * (halfH + pad)
        let i = layer.count
        data[i++] = cx + localX
        data[i++] = cy + localY
        data[i++] = localX
        data[i++] = localY
        data[i++] = shape[0]
        data[i++] = shape[1]
        data[i++] = shape[2]
        data[i++] = shape[3]
        data[i++] = col[0]
        data[i++] = col[1]
        data[i++] = col[2]
        data[i++] = col[3]
        layer.count = i
      }
      this.#corners(corner)
    })
  }

  // How far the pen moves across one character, in atlas units. Anything outside the atlas
  // takes a space's width, so a string the face cannot draw still occupies room rather than
  // collapsing whatever is laid out after it.
  #advanceOf(atlas, code, weight) {
    const row = atlas.advances[weight]
    if (code < FIRST_CODE || code > LAST_CODE) {
      return row[0]
    }
    return row[code - FIRST_CODE]
  }

  // The width of a run, which is a sum and not a multiplication: the faces this can be asked
  // to draw in are not all monospaced. `bold` because a bold advance is not its regular one,
  // and a caller laying something out after a bold run has to be told the truth about it.
  measureText(str, size = 12, bold = false) {
    const atlas = this.atlas
    const weight = bold ? 1 : 0
    let total = 0
    for (let index = 0; index < str.length; index++) {
      total += this.#advanceOf(atlas, str.charCodeAt(index), weight)
    }
    return total * (size / ATLAS_FONT)
  }

  text(str, x, y, opts = {}) {
    const size = opts.size || 12
    const colour = this.#colour(opts)
    const atlas = this.atlas
    const scale = size / ATLAS_FONT
    const total = this.measureText(str, size, opts.bold)
    const left = opts.align === "right" ? x - total : opts.align === "center" ? x - total / 2 : x
    // The alphabetic baseline sits at y; "middle" nudges the run down so a line
    // centres on y instead.
    const baselineY = opts.baseline === "middle" ? y + size * 0.36 : y
    const top = baselineY - atlas.baseline * scale
    const cellW = atlas.cellW * scale
    const cellH = atlas.cellH * scale
    const du = atlas.cellW / atlas.canvas.width
    const dv = atlas.cellH / atlas.canvas.height
    const weight = opts.bold ? 1 : 0
    const weightRow = weight ? atlas.rowsPerWeight : 0
    this.#emit("text", colour, opts.glow || 0, (layer, col) => {
      this.#reserve(layer, str.length * 6 * 8)
      const data = layer.data
      // A pen, not a column: each character moves it by its own advance.
      let pen = left
      for (let index = 0; index < str.length; index++) {
        const code = str.charCodeAt(index)
        const step = this.#advanceOf(atlas, code, weight) * scale
        if (code <= 32 || code > LAST_CODE) {
          // Nothing to draw, and the pen still moves: a space is a space.
          pen += step
          continue
        }
        const glyph = code - FIRST_CODE
        const u0 = (glyph % atlas.cols) * du
        const v0 = (Math.floor(glyph / atlas.cols) + weightRow) * dv
        const x0 = pen
        pen += step
        const corner = (dx, dy) => {
          let i = layer.count
          data[i++] = x0 + dx * cellW
          data[i++] = top + dy * cellH
          data[i++] = u0 + dx * du
          data[i++] = v0 + dy * dv
          data[i++] = col[0]
          data[i++] = col[1]
          data[i++] = col[2]
          data[i++] = col[3]
          layer.count = i
        }
        corner(0, 0)
        corner(1, 0)
        corner(1, 1)
        corner(0, 0)
        corner(1, 1)
        corner(0, 1)
      }
    })
  }

  // The six corners of a quad, in the winding every builder here uses.
  #corners(corner) {
    corner(-1, -1)
    corner(1, -1)
    corner(1, 1)
    corner(-1, -1)
    corner(1, 1)
    corner(-1, 1)
  }

  // A centred quad whose vertices are written by `write(emit, dx, dy)`, where
  // emit takes the shader's own attributes after the position. The layout is the
  // disc pipeline's: position, uv, a four-float shape and a colour.
  #quad(layer, x, y, extent, write) {
    this.#reserve(layer, 6 * 16)
    const data = layer.data
    const corner = (dx, dy) => {
      const emit = (u, v, shape, col, form = NO_FORM) => {
        let i = layer.count
        data[i++] = x + dx * extent
        data[i++] = y + dy * extent
        data[i++] = u
        data[i++] = v
        data[i++] = shape[0]
        data[i++] = shape[1]
        data[i++] = shape[2]
        data[i++] = shape[3]
        data[i++] = col[0]
        data[i++] = col[1]
        data[i++] = col[2]
        data[i++] = col[3]
        data[i++] = form[0]
        data[i++] = form[1]
        data[i++] = form[2]
        data[i++] = form[3]
        layer.count = i
      }
      write(emit, dx, dy)
    }
    this.#corners(corner)
  }

  // ---- post processing ----------------------------------------------------
  // A blurred copy of the frame as it stands, for anything drawn over it to frost
  // against. Shares the scratch targets with the glow blur, which happens later and
  // overwrites them.
  #blurBehind() {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.emptyVao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurA.fbo)
    gl.viewport(0, 0, this.blurA.w, this.blurA.h)
    gl.useProgram(this.progs.blit)
    this.#bindTex(this.progs.blit, "uTex", this.scene.tex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let pass = 0; pass < 2; pass++) {
      this.#blurPass(this.blurA, this.blurB, [1.6 / this.blurA.w, 0])
      this.#blurPass(this.blurB, this.blurA, [0, 1.6 / this.blurA.h])
    }
    gl.enable(gl.BLEND)
  }

  #blurGlow() {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.emptyVao)
    // Down to quarter resolution first, then two separable passes, which is a
    // wide soft halo for very little work.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurA.fbo)
    gl.viewport(0, 0, this.blurA.w, this.blurA.h)
    gl.useProgram(this.progs.blit)
    this.#bindTex(this.progs.blit, "uTex", this.glow.tex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let pass = 0; pass < 2; pass++) {
      this.#blurPass(this.blurA, this.blurB, [1.4 / this.blurA.w, 0])
      this.#blurPass(this.blurB, this.blurA, [0, 1.4 / this.blurA.h])
    }
    gl.enable(gl.BLEND)
  }

  #blurPass(src, dst, dir) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
    gl.viewport(0, 0, dst.w, dst.h)
    gl.useProgram(this.progs.blur)
    this.#bindTex(this.progs.blur, "uTex", src.tex, 0)
    gl.uniform2f(this.#uniform(this.progs.blur, "uDir"), dir[0], dir[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  #composite() {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    // Letterbox: clear the whole canvas to the field's own colour, then draw the
    // scene into the content rectangle.
    const c = this.clearColour
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(c[0] * this.brightness, c[1] * this.brightness, c[2] * this.brightness, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const rect = this.contentRect || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }
    gl.viewport(rect.x, rect.y, rect.w, rect.h)
    const prog = this.progs.composite
    gl.useProgram(prog)
    this.#bindTex(prog, "uScene", this.scene.tex, 0)
    this.#bindTex(prog, "uGlow", this.blurA.tex, 1)
    gl.uniform1f(this.#uniform(prog, "uGlow0"), this.glowIntensity)
    gl.uniform1f(this.#uniform(prog, "uBrightness"), clamp(this.brightness, 0, 1))
    gl.uniform1f(this.#uniform(prog, "uVignette"), clamp(this.vignette, 0, 1))
    gl.bindVertexArray(this.emptyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.BLEND)
  }

  #bindTex(prog, name, tex, unit) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.#uniform(prog, name), unit)
  }

  // Called by the view on resize with the letterboxed content rectangle in CSS
  // pixels; the gl viewport origin is bottom-left, so y is flipped here.
  setContentRect(xCss, yCss, wCss, hCss, dpr) {
    const w = Math.round(wCss * dpr)
    const h = Math.round(hCss * dpr)
    const x = Math.round(xCss * dpr)
    const y = this.canvas.height - Math.round(yCss * dpr) - h
    this.contentRect = { x, y, w, h }
  }
}
