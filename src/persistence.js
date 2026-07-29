// What the game remembers between sessions, in IndexedDB: the best score per
// mode, the settings and the control bindings. Best-effort throughout, and every
// failure is swallowed so the game still runs where storage is unavailable (over
// file:// it may be blocked, and then nothing is remembered but nothing breaks).

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dots", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("kv")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// One key/value store, so a new thing to remember is a new key and nothing else.
async function load(key) {
  try {
    const db = await openDatabase()
    const request = db.transaction("kv", "readonly").objectStore("kv").get(key)
    const value = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
    return value ?? null
  } catch {
    return null
  }
}

async function save(key, value) {
  try {
    const db = await openDatabase()
    db.transaction("kv", "readwrite").objectStore("kv").put(value, key)
  } catch {
    /* ignore */
  }
}

// Best score per mode, as { [modeId]: score }: a board six across is not the same
// game as one nine across, so they do not share a record.
export const loadBest = () => load("best")
export const saveBest = (best) => save("best", best)

// Theme, brightness and sound, kept apart from the bindings so resetting one does
// not throw away the other.
export const loadSettings = () => load("settings")
export const saveSettings = (settings) => save("settings", settings)

export const loadBindings = () => load("bindings")
export const saveBindings = (bindings) => save("bindings", bindings)

// How far a mode with authored levels has got, as { [modeId]: { [levelIndex]: best score } }.
// The best score per level is the whole record: a key being present is what says the level
// has been cleared, which is what unlocks the next one, and the score against that level's
// par is what says whether it was cleared for a star. Kept apart from `best`, which is one
// number for a whole mode.
export const loadProgress = () => load("progress")
export const saveProgress = (progress) => save("progress", progress)

// Best score per seed, as { [code]: score }. Kept apart from `best`, which holds one number
// for the whole seeded mode: that is the best board anyone was ever dealt, and this is what
// a particular board has given up, which is the only figure worth comparing with another
// player. Keyed by the code as it is written, so the record reads as itself.
export const loadSeedBest = () => load("seedBest")
export const saveSeedBest = (seedBest) => save("seedBest", seedBest)
