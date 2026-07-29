// The menus reading themselves out.
//
// This is off by default and has to be, because there is no way to ask. No browser
// reports whether a screen reader is running: assistive technology is deliberately
// private, being both a fingerprinting signal and a disclosure about the person using it.
// The accessibility preferences a browser will answer for - reduced motion, contrast,
// transparency, forced colours - say nothing about speech, and reading one of them as
// "speak to me" would be guessing at somebody's needs from an unrelated preference.
//
// What can be asked is whether speech works at all, which is what `available` is for.
//
// The other reason it stays off: where a screen reader is running, the player already has
// a voice, a rate and a language they chose, and this speaking too would be two voices
// over each other. So no voice is picked here either - whatever the browser's default is,
// is the one the player set.

import { CONFIG } from "./config.js"

export const Speech = {
  enabled: false,
  // What is waiting to be said, and the timer that will say it. See say().
  pending: null,
  timer: null,

  // Whether this browser can speak. Present in every current browser; absent under Node,
  // which is what the tests exercise, and voiceless on a machine with no speech installed.
  get available() {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined"
  },

  // Say something, a moment from now, instead of whatever was about to be said.
  //
  // The wait is what keeps the voice off the item's own tone and out of its own way: the
  // cursor moves faster than a voice can talk, so anything said the instant it moves is
  // either talking over the blip or being cut off by the next item. Replacing the pending
  // line rather than queueing it is the whole trick - a page walked from top to bottom
  // ticks all the way down and then says where it stopped.
  say(text) {
    if (!this.enabled || !this.available || !text) {
      return
    }
    this.pending = text
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), CONFIG.SPEECH_DELAY * 1000)
  },

  // Say it now, whatever is being said currently. For the one announcement that must not
  // wait: the toggle confirming itself, which is the press that turned speech on.
  sayNow(text) {
    if (!this.enabled || !this.available || !text) {
      return
    }
    this.pending = text
    clearTimeout(this.timer)
    this.flush()
  },

  // Say the pending line now. Called by the timer, and by sayNow.
  flush() {
    const text = this.pending
    this.pending = null
    this.timer = null
    if (!text) {
      return
    }
    try {
      // Cancelling first is not optional: without it every line waits for the last to
      // finish and the voice ends up a page behind the cursor.
      speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = CONFIG.SPEECH_RATE
      // The page's language, so the browser's matching voice is the one that reads it. No
      // voice is chosen: the default is the one the player set.
      utterance.lang = (typeof document !== "undefined" && document.documentElement.lang) || "en"
      speechSynthesis.speak(utterance)
    } catch {
      /* speech is best-effort */
    }
  },

  // Stop talking: on turning the setting off, and when the page is hidden, since speech
  // carries on after a tab is left.
  silence() {
    this.pending = null
    clearTimeout(this.timer)
    this.timer = null
    if (!this.available) {
      return
    }
    try {
      speechSynthesis.cancel()
    } catch {
      /* speech is best-effort */
    }
  },

  setEnabled(on) {
    this.enabled = on && this.available
    if (!this.enabled) {
      this.silence()
    }
    return this.enabled
  },
}
