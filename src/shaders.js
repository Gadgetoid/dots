// The GLSL the WebGL2 backend compiles. Nothing here touches the GL context or
// holds any state: it is source text, so glrenderer.js owns every program built
// from it and this file can be read on its own to see what a pass does.
//
// Naming: a _VS is a vertex shader and a _FS a fragment shader.
//
// Nothing inside a shader string may contain a backtick or a dollar: these are
// template literals, and either one ends the shader early.
//
// Every pass writes premultiplied alpha, so the two blend modes the renderer uses
// are (ONE, ONE_MINUS_SRC_ALPHA) to draw over and (ONE, ONE) to add. Coverage is
// worked out from a signed distance and `fwidth`, which is what makes the edges
// smooth at any canvas size: the antialiasing is a pixel wide because the shader
// asks the rasteriser how big a pixel is, rather than being told a scale.

// Shared vertex prologue: a straight orthographic map from view units to NDC,
// with y running down the screen as the game's coordinates do.
const PROJECT = `
  uniform vec2 uViewport;
  vec4 project(vec2 p) {
    vec2 ndc = p / uViewport * 2.0 - 1.0;
    return vec4(ndc.x, -ndc.y, 0.0, 1.0);
  }
`

// ---------------------------------------------------------------------------
// Dots. One quad per dot, with the shape cut out of it by a distance field, so a
// dot is round at any size and costs two triangles.
//
// The wobble is the jelly: it scales the radius by a two-lobed cosine about
// `dir`, so a positive amplitude stretches the dot along that axis and squashes
// it across, and the oscillator driving it swaps the two as it rings.
// ---------------------------------------------------------------------------
export const DISC_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec2 aUV;       // -1..1 across the quad
  layout(location=2) in vec4 aShape;    // wobble amount, wobble axis, ring half-width, sheen
  layout(location=3) in vec4 aColor;
  out vec2 vUV; out vec4 vShape; out vec4 vColor;
  ${PROJECT}
  void main() {
    vUV = aUV; vShape = aShape; vColor = aColor;
    gl_Position = project(aPos);
  }`
export const DISC_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; in vec4 vShape; in vec4 vColor;
  out vec4 frag;
  void main() {
    float radius = length(vUV);
    float angle = atan(vUV.y, vUV.x);
    float wobble = 1.0 + vShape.x * cos(2.0 * (angle - vShape.y));
    // Signed distance to the deformed edge, in quad units, then in pixels.
    float d = radius / max(wobble, 0.2) - 1.0;
    float aa = max(fwidth(d), 1e-5);
    float cov;
    if (vShape.z > 0.0) {
      cov = 1.0 - smoothstep(vShape.z - aa, vShape.z + aa, abs(d));
    } else {
      cov = 1.0 - smoothstep(-aa, aa, d);
    }
    // A soft highlight up and to the left, so a dot reads as a bead rather than a
    // flat circle. Scaled by coverage like everything else, so it never leaks.
    vec3 col = vColor.rgb;
    col += vShape.w * pow(clamp(1.0 - length(vUV - vec2(-0.34, -0.36)) * 0.92, 0.0, 1.0), 3.0);
    float a = cov * vColor.a;
    frag = vec4(col * a, a);
  }`

// ---------------------------------------------------------------------------
// Ribbons: the chain line, and the streak behind a spark. A triangle strip laid
// along a polyline, one quad per segment, carrying the transverse coordinate so
// the edges can be antialiased and the colour per vertex so a streak can fade
// along its length.
// ---------------------------------------------------------------------------
export const RIBBON_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec2 aEdge;     // -1..1 across the ribbon, half-width in view units
  layout(location=2) in vec4 aColor;
  out vec2 vEdge; out vec4 vColor;
  ${PROJECT}
  void main() { vEdge = aEdge; vColor = aColor; gl_Position = project(aPos); }`
export const RIBBON_FS = `#version 300 es
  precision highp float;
  in vec2 vEdge; in vec4 vColor;
  out vec4 frag;
  void main() {
    float inside = (1.0 - abs(vEdge.x)) * vEdge.y;   // view units in from the edge
    float aa = max(fwidth(inside), 1e-5);
    float cov = clamp(inside / aa + 0.5, 0.0, 1.0);
    float a = cov * vColor.a;
    frag = vec4(vColor.rgb * a, a);
  }`

// Soft round sprites: particle bodies, the halo under a glowing dot, anything
// that is light rather than a shape. `aExp` sets how tight the falloff is.
export const SPRITE_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec2 aUV;
  layout(location=2) in float aExp;
  layout(location=3) in vec4 aColor;
  out vec2 vUV; out float vExp; out vec4 vColor;
  ${PROJECT}
  void main() { vUV = aUV; vExp = aExp; vColor = aColor; gl_Position = project(aPos); }`
export const SPRITE_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; in float vExp; in vec4 vColor;
  out vec4 frag;
  void main() {
    float inten = pow(clamp(1.0 - length(vUV), 0.0, 1.0), vExp);
    float a = inten * vColor.a;
    frag = vec4(vColor.rgb * a, a);
  }`

// Rounded rectangles: the score bar, menu panels, buttons and the empty cells the
// board is drawn on. A border is the same field measured from either side, so one
// pass fills and outlines.
export const PANEL_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec2 aLocal;    // offset from the centre, in view units
  layout(location=2) in vec4 aShape;    // half width, half height, corner radius, border half-width
  layout(location=3) in vec4 aColor;
  out vec2 vLocal; out vec4 vShape; out vec4 vColor;
  ${PROJECT}
  void main() { vLocal = aLocal; vShape = aShape; vColor = aColor; gl_Position = project(aPos); }`
export const PANEL_FS = `#version 300 es
  precision highp float;
  in vec2 vLocal; in vec4 vShape; in vec4 vColor;
  out vec4 frag;
  void main() {
    // Named for what it is - the box the corner arcs are struck from - because
    // "half" is a reserved word in GLSL ES and will not compile.
    vec2 inner = max(vShape.xy - vShape.z, vec2(0.0));
    float d = length(max(abs(vLocal) - inner, vec2(0.0))) - vShape.z;
    float aa = max(fwidth(d), 1e-5);
    float cov;
    if (vShape.w > 0.0) {
      cov = 1.0 - smoothstep(vShape.w - aa, vShape.w + aa, abs(d));
    } else {
      cov = 1.0 - smoothstep(-aa, aa, d);
    }
    float a = cov * vColor.a;
    frag = vec4(vColor.rgb * a, a);
  }`

// Text from the monospace atlas, whose coverage is stored in the red channel.
export const TEXT_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec2 aUV;
  layout(location=2) in vec4 aColor;
  out vec2 vUV; out vec4 vColor;
  ${PROJECT}
  void main() { vUV = aUV; vColor = aColor; gl_Position = project(aPos); }`
export const TEXT_FS = `#version 300 es
  precision highp float;
  uniform sampler2D uAtlas;
  in vec2 vUV; in vec4 vColor; out vec4 frag;
  void main() {
    float cov = texture(uAtlas, vUV).r;
    float a = cov * vColor.a;
    frag = vec4(vColor.rgb * a, a);
  }`

// Full-screen passes share a fullscreen-triangle vertex shader.
export const FSTRI_VS = `#version 300 es
  precision highp float;
  out vec2 vUV;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUV = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`

export const BLUR_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 frag;
  uniform sampler2D uTex;
  uniform vec2 uDir;   // texel step along one axis
  void main() {
    vec4 sum = texture(uTex, vUV) * 0.227027;
    sum += texture(uTex, vUV + uDir * 1.3846) * 0.316216;
    sum += texture(uTex, vUV - uDir * 1.3846) * 0.316216;
    sum += texture(uTex, vUV + uDir * 3.2308) * 0.070270;
    sum += texture(uTex, vUV - uDir * 3.2308) * 0.070270;
    frag = sum;
  }`

// Straight copy, used to bring the glow layer down to half resolution before it
// is blurred.
export const BLIT_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 frag;
  uniform sampler2D uTex;
  void main() { frag = texture(uTex, vUV); }`

// The frame as the player sees it: the scene, plus the blurred glow layer added
// over it, scaled by the brightness setting.
//
// The glow is its own layer rather than a threshold on the scene, because this
// game has a light theme: a bright-pass would take a white background for light
// worth blooming and fog the board. Only what the view marks as glowing is in
// there, so the effect is the same on either theme.
export const COMPOSITE_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 frag;
  uniform sampler2D uScene;
  uniform sampler2D uGlow;
  uniform float uGlow0;        // how much of the blurred glow to add back
  uniform float uBrightness;   // the night-time setting, applied to the whole frame
  uniform float uVignette;     // gentle darkening toward the corners, 0 = off
  void main() {
    vec3 col = texture(uScene, vUV).rgb + texture(uGlow, vUV).rgb * uGlow0;
    vec2 c = vUV * 2.0 - 1.0;
    float vig = mix(1.0, smoothstep(2.4, 0.35, dot(c, c)), uVignette);
    frag = vec4(col * vig * uBrightness, 1.0);
  }`
