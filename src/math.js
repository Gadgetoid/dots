// Small maths helpers. Nothing here holds game state, so all of it is testable
// without a browser.

export const TAU = Math.PI * 2

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)
export const lerp = (a, b, t) => a + (b - a) * t
export const randRange = (min, max) => min + Math.random() * (max - min)

// Deterministic PRNG, so a mode can be handed a seed and deal the same board
// twice. Returns a function producing 0..1, in the shape Math.random has.
export function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fast at the start and slow at the end, which is what an expanding shockwave
// does: most of its travel is over in the first few frames.
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

// A damped harmonic oscillator, integrated semi-implicitly so a stiff spring
// stays stable at a long frame. `state` is mutated in place and carries
// { value, velocity }; the impulse that starts it off is a velocity.
//
// This is what makes a dot jelly: a nudge sets the velocity and the dot squashes,
// overshoots into a stretch and settles.
export function springStep(state, stiffness, damping, dt) {
  state.velocity += (-stiffness * state.value - damping * state.velocity) * dt
  state.value += state.velocity * dt
  return state
}
