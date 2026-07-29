// Everything short-lived the board throws off: sparks, dust, the ring a pop
// pushes out, and the score that floats up off a spent chain.
//
// Four lists rather than one, because each is simulated and drawn differently and
// a per-particle type switch in the inner loop is the one thing worth avoiding
// here. Dead entries are compacted in place, so a busy board does not churn
// through objects.

import { CONFIG } from "./config.js"
import { randRange, TAU } from "./math.js"

// Keep the live entries of `list`, in order, and drop the rest.
function compact(list, alive) {
  let keep = 0
  for (let i = 0; i < list.length; i++) {
    if (alive(list[i])) {
      list[keep++] = list[i]
    }
  }
  list.length = keep
}

export class Particles {
  constructor() {
    // Bright, fast and streaked: what a dot bursting into light looks like.
    this.sparks = []
    // Slow, soft and round: what is left drifting afterwards.
    this.dust = []
    // The shockwave a pop pushes out through its neighbours.
    this.rings = []
    // The instant of a pop: a bright bloom where the dot was, gone in a sixth of a
    // second.
    this.flashes = []
    // Score, rising off the chain that earned it.
    this.floaters = []
  }

  get count() {
    return this.sparks.length + this.dust.length + this.rings.length + this.flashes.length
  }

  clear() {
    this.sparks.length = 0
    this.dust.length = 0
    this.rings.length = 0
    this.flashes.length = 0
    this.floaters.length = 0
  }

  spark(x, y, colour, speed, size = 2.6) {
    if (this.sparks.length >= CONFIG.MAX_PARTICLES) {
      return
    }
    const angle = randRange(0, TAU)
    this.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      colour,
      size,
      age: 0,
      life: randRange(CONFIG.SPARK_LIFE[0], CONFIG.SPARK_LIFE[1]),
    })
  }

  mote(x, y, colour, speed, size = 5) {
    if (this.dust.length >= CONFIG.MAX_PARTICLES) {
      return
    }
    const angle = randRange(0, TAU)
    this.dust.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      colour,
      size: size * randRange(0.7, 1.4),
      age: 0,
      life: randRange(CONFIG.DUST_LIFE[0], CONFIG.DUST_LIFE[1]),
    })
  }

  ring(x, y, colour, radius, life = CONFIG.POP_RING_LIFE, width = 3) {
    this.rings.push({ x, y, colour, radius, width, age: 0, life })
  }

  floater(x, y, text, colour, scale = 1) {
    this.floaters.push({ x, y, text, colour, scale, age: 0, life: CONFIG.FLOATER_LIFE })
  }

  flash(x, y, colour, size) {
    this.flashes.push({ x, y, colour, size, age: 0, life: CONFIG.POP_FLASH_LIFE })
  }

  // A dot going: the flash, a hard burst of sparks, a little dust behind it, and a
  // ring. `scale` follows the dot radius, so the effect fits a 4x4 board and a 9x9
  // one, and `radius` is the dot's own so the flash covers where it was.
  pop(x, y, colour, scale, radius) {
    this.flash(x, y, colour, radius * CONFIG.POP_FLASH_SIZE)
    for (let i = 0; i < CONFIG.POP_SPARKS; i++) {
      const speed = randRange(CONFIG.POP_SPARK_SPEED[0], CONFIG.POP_SPARK_SPEED[1]) * scale
      this.spark(x, y, colour, speed, randRange(1.6, 3.4) * scale)
    }
    for (let i = 0; i < CONFIG.POP_DUST; i++) {
      const speed = randRange(CONFIG.POP_DUST_SPEED[0], CONFIG.POP_DUST_SPEED[1]) * scale
      this.mote(x, y, colour, speed, randRange(3, 7) * scale)
    }
    this.ring(x, y, colour, CONFIG.POP_RING_RADIUS * 20 * scale, CONFIG.POP_RING_LIFE, 3 * scale)
  }

  // One spark thrown along a live chain, so a chain being built has something
  // running through it.
  trail(x, y, colour, scale) {
    this.spark(x, y, colour, randRange(8, 40) * scale, randRange(1.2, 2.4) * scale)
  }

  step(dt) {
    const drag = Math.max(0, 1 - CONFIG.PARTICLE_DRAG * dt)
    for (const spark of this.sparks) {
      spark.age += dt
      spark.vx *= drag
      spark.vy = spark.vy * drag + CONFIG.PARTICLE_GRAVITY * dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
    }
    // Dust ignores gravity almost entirely: it hangs where the dot was, which is
    // what leaves a ghost of the chain behind for a moment.
    for (const mote of this.dust) {
      mote.age += dt
      mote.vx *= drag
      mote.vy = mote.vy * drag + CONFIG.PARTICLE_GRAVITY * 0.06 * dt
      mote.x += mote.vx * dt
      mote.y += mote.vy * dt
    }
    for (const ring of this.rings) {
      ring.age += dt
    }
    for (const flash of this.flashes) {
      flash.age += dt
    }
    for (const floater of this.floaters) {
      floater.age += dt
      floater.y -= CONFIG.FLOATER_RISE * dt * (1 - floater.age / floater.life)
    }
    const alive = (entry) => entry.age < entry.life
    compact(this.sparks, alive)
    compact(this.dust, alive)
    compact(this.rings, alive)
    compact(this.flashes, alive)
    compact(this.floaters, alive)
  }
}
