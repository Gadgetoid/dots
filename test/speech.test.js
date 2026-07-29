// The spoken menus, against a stub speechSynthesis.
//
// Two things here are worth holding onto. The first is that nothing is said while the
// setting is off, including nothing queued up to be said later: an accessibility feature
// that talks to a player who did not ask for it is a bug of a worse kind than silence. The
// second is that a line replaces the one waiting rather than joining a queue - the reason
// walking a page does not leave the voice reading out items the cursor left long ago.

import test from "node:test"
import assert from "node:assert/strict"

import { Speech } from "../src/speech.js"
import { Game } from "../src/game.js"
import { CONFIG } from "../src/config.js"

// Records what it was asked to say, and in what order relative to being cancelled.
class SynthStub {
  constructor() {
    this.spoken = []
    this.cancels = 0
  }
  cancel() {
    this.cancels++
  }
  speak(utterance) {
    this.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate })
  }
  get last() {
    return this.spoken[this.spoken.length - 1]
  }
}

function withSynth(run) {
  const synth = new SynthStub()
  globalThis.speechSynthesis = synth
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text
    }
  }
  try {
    return run(synth)
  } finally {
    Speech.setEnabled(false)
    delete globalThis.speechSynthesis
    delete globalThis.SpeechSynthesisUtterance
  }
}

const FRAME = 1 / 60

test("nothing is said until it is asked for", () => {
  withSynth((synth) => {
    Speech.setEnabled(false)
    Speech.say("not this")
    Speech.sayNow("nor this")
    assert.equal(Speech.pending, null, "nothing is even waiting")
    Speech.flush()
    assert.deepEqual(synth.spoken, [])
  })
})

test("speech is unavailable without the API, and cannot be turned on", () => {
  assert.equal(Speech.available, false, "no speechSynthesis under node")
  assert.equal(Speech.setEnabled(true), false, "so it stays off")
  Speech.say("silence")
  assert.equal(Speech.pending, null)
})

test("a line waits, then replaces the one waiting", () => {
  withSynth((synth) => {
    Speech.setEnabled(true)
    Speech.say("first")
    assert.equal(synth.spoken.length, 0, "nothing is said on the instant")
    assert.equal(Speech.pending, "first", "it is waiting")
    // What the cursor moving on looks like: the item left behind is never spoken.
    Speech.say("second")
    Speech.say("third")
    assert.equal(Speech.pending, "third")
    Speech.flush()
    assert.deepEqual(
      synth.spoken.map((entry) => entry.text),
      ["third"],
    )
    assert.equal(synth.cancels, 1, "and it cut off whatever was talking")
    assert.equal(synth.last.rate, CONFIG.SPEECH_RATE)
  })
})

test("the wait clears the item's own tone and outlasts a held direction", () => {
  // The two numbers this delay sits between: it has to be longer than the menu blip so the
  // two are not talking at once, and longer than the repeat interval so a held key ticks
  // down a page and speaks only where it stops.
  const TONE = 0.09
  assert.ok(CONFIG.SPEECH_DELAY > TONE, "past the end of the tone")
  assert.ok(CONFIG.SPEECH_DELAY < 0.35, "and still prompt")
})

test("turning it on says so at once", () => {
  withSynth((synth) => {
    const game = new Game()
    assert.equal(game.speechOn, false, "off to begin with")
    assert.equal(game.setSpeech(true), true)
    assert.equal(game.speechOn, true)
    assert.equal(synth.spoken.length, 1, "without waiting: this press asked for it")
    assert.match(synth.last.text, /^Speech on/)
    // And the item the cursor is on, so the first thing heard is where the player is.
    assert.match(synth.last.text, /New game/)
  })
})

test("walking the menus says what is under the cursor", () => {
  withSynth(() => {
    const game = new Game()
    game.setSpeech(true)
    game.page = "settings"
    game.menuIndex = 0
    game.menuOption = 0

    const rows = game.menuRows()
    const speech = rows.map((row, index) => {
      game.menuIndex = index
      game.menuOption = 0
      return game.menuSpeech()
    })
    // A settings row says its name, then its value, then what the value means.
    assert.ok(
      speech.some((line) => line.startsWith("Speech, On,")),
      `the speech row names itself: ${JSON.stringify(speech)}`,
    )
    assert.ok(
      speech.some((line) => line.startsWith("Theme,")),
      "and so does every other",
    )
    // A button says what it is. Back is Back, wherever it has been put.
    assert.ok(
      speech.some((line) => line === "Back"),
      "the way out is named",
    )
    for (const line of speech) {
      assert.equal(typeof line, "string")
      assert.ok(!line.includes("undefined"), `no gaps in "${line}"`)
    }
  })
})

test("a page announces itself, once, however it was opened", () => {
  withSynth((synth) => {
    const game = new Game()
    game.setSpeech(true)
    synth.spoken.length = 0

    game.advance(FRAME)
    Speech.flush()
    assert.match(synth.last.text, /^Dots\./, "the page it is already on")
    const said = synth.spoken.length

    // Sitting on the same page says nothing more.
    for (let i = 0; i < 30; i++) {
      game.advance(FRAME)
    }
    Speech.flush()
    assert.equal(synth.spoken.length, said, "and it is not repeated")

    game.menuTap(0)
    assert.equal(game.page, "modes")
    game.advance(FRAME)
    Speech.flush()
    assert.match(synth.last.text, /^New game\./, "and the next page names itself")
  })
})

test("the board says nothing, and stops talking when it starts", () => {
  withSynth((synth) => {
    const game = new Game()
    game.setSpeech(true)
    game.start("classic")
    game.advance(FRAME)
    assert.equal(game.page, null)
    assert.equal(Speech.pending, null, "a half-read menu is not read over the game")
    synth.spoken.length = 0
    for (let i = 0; i < 120; i++) {
      game.advance(FRAME)
    }
    Speech.flush()
    assert.deepEqual(synth.spoken, [], "and playing is not narrated")
  })
})

test("the game-over page reads out the score", () => {
  withSynth((synth) => {
    const game = new Game()
    game.setSpeech(true)
    game.start("classic")
    for (let i = 0; i < 240; i++) {
      game.advance(FRAME)
    }
    // A board of two colours in a checkerboard has no move on it.
    for (const dot of game.board.dots) {
      dot.colour = (dot.col + dot.row) % 2
    }
    for (let i = 0; i < 240 && game.page !== "over"; i++) {
      game.advance(FRAME)
    }
    assert.equal(game.page, "over")
    game.advance(FRAME)
    Speech.flush()
    assert.match(synth.last.text, /No moves left/)
    assert.match(synth.last.text, new RegExp(`${game.player.score}`))
  })
})

test("a level cleared is announced on its own account", () => {
  withSynth((synth) => {
    const game = new Game()
    game.setSpeech(true)
    game.start("puzzle")
    for (let i = 0; i < 240; i++) {
      game.advance(FRAME)
    }
    game.board.remove(game.board.dots.slice())
    for (let i = 0; i < 180 && !game.banner; i++) {
      game.advance(FRAME)
    }
    assert.ok(game.banner, "there was a banner")
    game.advance(FRAME)
    Speech.flush()
    assert.match(synth.last.text, /Level cleared/, "which is not attached to any cursor")
  })
})

test("turning it off stops it mid-sentence", () => {
  withSynth((synth) => {
    const game = new Game()
    game.setSpeech(true)
    Speech.say("half a line")
    assert.equal(Speech.pending, "half a line")
    game.setSpeech(false)
    assert.equal(game.speechOn, false)
    assert.equal(Speech.pending, null, "nothing is left waiting")
    Speech.flush()
    assert.equal(
      synth.spoken.filter((entry) => entry.text === "half a line").length,
      0,
      "and what was waiting is dropped",
    )
  })
})
