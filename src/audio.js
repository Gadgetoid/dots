// Tiny synthesised sound effects, created lazily on the first user gesture.
//
// The engine is Geometry II's: one master gain, then a soft-clip shaper so a pile
// of effects is squashed rather than clipped, and every voice is a couple of
// oscillators or a filtered noise burst. What is different is the voicing. This
// game is quiet and slow, so every voice here is a sine or a triangle through a
// gentle low-pass, with a few milliseconds of attack on the front of it: an
// envelope that starts at full level clicks, and a click is the one thing a mellow
// sound cannot have.
//
// Popping a chain plays one blip per dot, walking up a pentatonic scale as the
// chain unzips, each one detuned a hair from the last. That is the game's signature
// sound and it is deliberately the same voice the ore pickup used in Geometry II.

import { randRange } from "./math.js"
import { CONFIG } from "./config.js"
import { buildTuning, noteFrequency, DEFAULT_TUNING, MENU_ROOT } from "./scales.js"

// Pitch spread on each blip, about a tenth of a semitone either way, so a run
// shimmers instead of sounding sequenced.
const POP_DETUNE = 0.006

// A frequency ratio for a number of semitones, which is what the menus are tuned in: see
// menuMove, and MENU_NOTES in config.js. Their root is fixed rather than the mode's, so an
// item sounds the same whatever the board is tuned to.
const semitones = (steps) => Math.pow(2, steps / 12)
const MENU_ROOT_HZ = noteFrequency(MENU_ROOT)

export const Sound = {
  enabled: false,
  ctx: null,
  unlocked: false,
  chain: null,
  // 0..1, on top of MASTER_VOLUME.
  volume: 1,

  // What the game is playing in. A mode sets this when it starts, so which scale the
  // dots are tuned to is the mode's business and not this file's.
  tuning: buildTuning(DEFAULT_TUNING),

  setTuning(tuning) {
    if (tuning && tuning.ratios && tuning.ratios.length > 0) {
      this.tuning = tuning
    }
  },

  // The frequency of a step up the current scale. Past the top of it the pitch holds
  // rather than climbing forever.
  note(step) {
    const ratios = this.tuning.ratios
    return this.tuning.rootHz * ratios[Math.min(Math.max(step, 0), ratios.length - 1)]
  },

  // Whether a real user gesture has happened yet. A browser will not open an audio device
  // outside one, and asking before it does leaves a suspended context and a complaint in
  // the console, so nothing here touches the device until the first key or touch. Set by
  // the page; see unlockAudio in main.js.
  gestured: false,

  ensureContext() {
    if (!this.gestured) {
      return
    }
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        /* audio is best-effort */
      }
    }
    if (!this.ctx) {
      return
    }
    // Safari and Chrome's autoplay policy hold the context in a non-running state
    // until it is resumed from a user gesture. Resume whenever it isn't running,
    // and play a one-shot silent buffer, which Safari needs to unlock output.
    if (this.ctx.state !== "running" && this.ctx.resume) {
      this.ctx.resume().catch(() => {})
    }
    if (!this.unlocked) {
      try {
        const source = this.ctx.createBufferSource()
        source.buffer = this.ctx.createBuffer(1, 1, 22050)
        source.connect(this.ctx.destination)
        source.start(0)
        this.unlocked = true
      } catch {
        /* ignore */
      }
    }
  },

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value))
    if (this.chain) {
      this.chain.gain.gain.value = CONFIG.MASTER_VOLUME * this.volume
    }
  },

  // Where every voice plays: the master gain, a low-pass that takes the edge off
  // everything, then the soft clip. The filter is what makes the set sound like
  // one instrument rather than a handful of oscillators.
  output() {
    if (!this.ctx) {
      return null
    }
    if (!this.chain || this.chain.ctx !== this.ctx) {
      const gain = this.ctx.createGain()
      gain.gain.value = CONFIG.MASTER_VOLUME * this.volume
      const warmth = this.ctx.createBiquadFilter()
      warmth.type = "lowpass"
      warmth.frequency.value = 3800
      warmth.Q.value = 0.4
      gain.connect(warmth).connect(this.softClip()).connect(this.ctx.destination)
      this.chain = { ctx: this.ctx, gain }
    }
    return this.chain.gain
  },

  // A shaper that is exactly linear below AUDIO_SOFT_CLIP and bends smoothly
  // toward full scale above it, so it can never put out more than full scale and
  // never colours anything quieter than the threshold.
  softClip() {
    const shaper = this.ctx.createWaveShaper()
    const threshold = CONFIG.AUDIO_SOFT_CLIP
    const points = 2048
    const curve = new Float32Array(points)
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * 2 - 1
      const size = Math.abs(x)
      const shaped =
        size <= threshold
          ? size
          : threshold + (1 - threshold) * Math.tanh((size - threshold) / (1 - threshold))
      curve[i] = Math.sign(x) * shaped
    }
    shaper.curve = curve
    shaper.oversample = "none"
    return shaper
  },

  // One voice. `attack` is why these do not click: the level ramps up over a few
  // milliseconds and then decays away, which is the difference between a note and
  // a tick. `delay` schedules it ahead, so a chain can be laid out in one go.
  voice(freq, duration, { wave = "sine", volume = 0.05, endFreq, attack = 0.012, delay = 0 } = {}) {
    if (!this.enabled) {
      return
    }
    this.ensureContext()
    if (!this.ctx) {
      return
    }
    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      const start = this.ctx.currentTime + delay
      osc.type = wave
      osc.frequency.setValueAtTime(freq, start)
      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), start + duration)
      }
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + attack)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      osc.connect(gain).connect(this.output())
      osc.start(start)
      osc.stop(start + duration + 0.02)
    } catch {
      /* ignore */
    }
  },

  // Filtered noise, for anything with a body rather than a pitch: a dot landing,
  // a board settling. Low-passed and quiet, so it reads as a soft knock.
  noise(duration, { volume = 0.03, freq = 400, q = 0.7, type = "lowpass", delay = 0 } = {}) {
    if (!this.enabled) {
      return
    }
    this.ensureContext()
    if (!this.ctx) {
      return
    }
    try {
      const start = this.ctx.currentTime + delay
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration))
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1
      }
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      const filter = this.ctx.createBiquadFilter()
      filter.type = type
      filter.frequency.value = freq
      filter.Q.value = q
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      source.connect(filter).connect(gain).connect(this.output())
      source.start(start)
      source.stop(start + duration + 0.02)
    } catch {
      /* ignore */
    }
  },

  // ---- the game's voices --------------------------------------------------
  // A dot joining the chain: a soft marimba-ish tap, climbing the scale as the
  // chain grows so building one is itself a tune.
  link(index) {
    this.voice(this.note(index) * randRange(1 - POP_DETUNE, 1 + POP_DETUNE), 0.22, {
      wave: "triangle",
      volume: 0.035,
      attack: 0.008,
    })
  },

  // One dot popping. `index` is its place in the chain and `delay` when it goes,
  // so the whole run is scheduled the moment the chain is spent and the audio
  // lands exactly with the particles.
  pop(index, delay = 0) {
    const pitch = this.note(index) * randRange(1 - POP_DETUNE, 1 + POP_DETUNE)
    this.voice(pitch, 0.16, {
      wave: "sine",
      volume: 0.055,
      // Up a fifth over the length of the note, which is the little upward flick
      // that makes it a pop.
      endFreq: pitch * 1.5,
      attack: 0.006,
      delay,
    })
    // A breath of air under the note, which is what makes it a pop rather than a
    // beep. Quiet enough that a long chain does not turn into a hiss.
    this.noise(0.09, { volume: 0.014, freq: 1500, q: 0.5, type: "bandpass", delay })
  },

  // Running the cursor over the board, with nothing in hand: what is under it, as a
  // sound. A cell with nothing worth taking says so dully and low; a dot at the head of
  // something says how much, a step up the scale for every dot it could reach. The two
  // are different instruments as well as different pitches, so "there is something here"
  // does not have to be judged by ear against a remembered note.
  //
  // Quiet and short, because this fires on every step across a board.
  cursor(reach, minChain = 2) {
    if (reach < minChain) {
      this.voice(this.note(0) * 0.5, 0.05, { wave: "sine", volume: 0.01, attack: 0.004 })
      return
    }
    this.voice(this.note(reach - 1), 0.08, {
      wave: "triangle",
      volume: 0.018,
      attack: 0.005,
    })
  },

  // A move that cannot happen: the edge of the board, or a dot the chain in hand has no
  // business on. Deliberately not a note in the scale - a hair flat of the octave below
  // the root, with a knock under it - so it reads as "no" rather than as something played.
  blocked() {
    this.voice(this.note(0) * 0.47, 0.07, { wave: "square", volume: 0.016, attack: 0.004 })
    this.noise(0.05, { volume: 0.012, freq: 180, q: 1.2 })
  },

  // Dropping a chain without spending it: the link tone, reversed.
  // Dropping a chain without spending it: the root, falling away under itself. Below
  // the scale rather than in it, since nothing was earned.
  cancel() {
    const root = this.note(0)
    this.voice(root * 0.75, 0.18, { wave: "sine", volume: 0.03, endFreq: root * 0.5 })
  },

  // A dot landing. Barely there on its own; a refilled board is a soft rain of
  // them, which is most of the game's texture.
  land(weight = 1) {
    this.noise(0.07, { volume: 0.012 * weight, freq: 220 + 120 * weight, q: 0.9 })
    this.voice(120 * randRange(0.94, 1.06), 0.08, {
      wave: "sine",
      volume: 0.012 * weight,
      attack: 0.004,
    })
  },

  // Banking a multiplier: high up the scale, an octave over the run that earned it.
  multiplier(level) {
    this.voice(this.note(level + 2) * 2, 0.5, { wave: "sine", volume: 0.03, attack: 0.03 })
  },

  // The board with no move left: two notes an octave under the root, falling away
  // slowly and off the scale altogether by the end.
  fail() {
    const root = this.note(0) * 0.5
    this.voice(root, 0.9, { wave: "sine", volume: 0.045, attack: 0.05, endFreq: root * 0.75 })
    this.voice(this.note(1) * 0.5, 1.1, {
      wave: "triangle",
      volume: 0.028,
      attack: 0.08,
      endFreq: root * 0.66,
      delay: 0.12,
    })
  },

  // A board cleared: a run up the scale the mode is in, slow and overlapping, so a
  // clear sounds like the same instrument the popping did.
  clear() {
    for (let i = 0; i < 4; i++) {
      this.voice(this.note(i + 2), 0.55, {
        wave: "sine",
        volume: 0.035,
        attack: 0.02,
        delay: i * 0.09,
      })
    }
  },

  // The menus are rooted in the same tuning as the board, so the whole game sounds like
  // one instrument however a mode is tuned - but they are chromatic rather than played on
  // the mode's own scale, since a scale comes round again an octave up and two menu items
  // an octave apart are two items that sound the same.
  //
  // `step` is which item this is, in semitones: see MENU_NOTES in config.js.
  menuMove(step = 0) {
    this.voice(MENU_ROOT_HZ * semitones(step), 0.09, {
      wave: "sine",
      volume: 0.022,
      attack: 0.005,
    })
  },

  menuConfirm() {
    const root = this.note(0)
    this.voice(root, 0.12, { wave: "sine", volume: 0.03, endFreq: this.note(2) })
  },

  menuBack() {
    const root = this.note(0)
    this.voice(root, 0.12, { wave: "sine", volume: 0.026, endFreq: root * 0.67 })
  },
}
