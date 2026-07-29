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
