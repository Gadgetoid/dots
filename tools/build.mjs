// Build the site that gets published: the scripts are bundled and minified, moved somewhere
// named after the commit, and the absolute URLs are pointed at wherever this copy is being
// published.
//
// The versioned directory is the whole cache-busting story. Every import in src is relative
// - "./config.js", never "/src/config.js" - so moving the directory moves the whole module
// graph with it, and one substitution in index.html is enough to make a deploy fetch every
// file afresh. Nothing inside src has to know about it.
//
// The entry page itself is the one thing that cannot be versioned, since its URL is the URL
// people have. GitHub Pages serves HTML with a ten minute cache, so that is the longest a
// player can be behind; every script and asset under it is immutable by name.
//
//   node tools/build.mjs                             # for a look, with relative URLs
//   node tools/build.mjs --base https://example.com --version abc123
//
// Output lands in _site/, which is what the Pages workflow uploads.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// The URL the tags in index.html are written with. Anything published somewhere else has
// these rewritten to its own base.
const HOME = "https://gadgetoid.github.io/dots"

// What goes up, besides the versioned scripts: the page, the card a link turns into, the file
// that tells Pages not to run the whole thing through Jekyll, and what has been proved about each
// level, which the strategy guide reads its solutions out of.
//
// The proved boards are not versioned with the scripts. They are keyed by board and by a
// fingerprint of what judged them, so a guide from one commit reading the file from another either
// finds the board it wants or works it out for itself; and the path is one the page holds rather
// than one a module holds.
const ASSETS = ["screenshots/social.png", ".nojekyll", "data/verified-boards.json"]

// The pages besides the game, each with the one script reference that has to be moved into the
// versioned directory. Neither is linked from the game.
const PAGES = [
  { file: "editor.html", entry: "src/editor/main.js" },
  { file: "strategy-guide.html", entry: "src/guide/main.js" },
]

// The workers, which are entry points too and are reached by neither an import nor a page: each
// is named by a `new Worker(new URL("./worker.js", import.meta.url))` in the module beside it.
// esbuild does not follow that, so a worker left off this list is a worker that is bundled into
// whatever imported it and then asked for by a URL that has nothing at it.
const WORKERS = ["src/editor/worker.js", "src/guide/worker.js"]

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

// The commit being published, cut to something that reads as a version rather than a hash.
// Twelve characters is far past the point of collision for one repository.
function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()
  } catch {
    return "dev"
  }
}

const out = path.resolve(ROOT, arg("out", "_site"))
const version = arg("version", currentCommit()).slice(0, 12)
// No trailing slash, so joining is predictable. An empty base leaves the page's URLs
// relative, which is what makes the output openable from a local server.
const base = arg("base", "").replace(/\/+$/, "")

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// The scripts, under a directory named after the commit. Copied whole first, for everything an
// import cannot reach - the fonts, which fonts.js asks for by URL - and then bundled over.
const scripts = path.join("v", version)
fs.cpSync(path.join(ROOT, "src"), path.join(out, scripts), { recursive: true })

// Every entry point, and where each has to land: exactly where the module it replaces was, because
// two things resolve against import.meta.url and both are relative to it - the fonts, and the
// workers. Bundling one to a different depth would move what it asks for.
const ENTRIES = ["src/main.js", ...PAGES.map(({ entry }) => entry), ...WORKERS]

// Everything the game ships as one file per entry, with the comments taken out.
//
// 44% of this source is comment, which is what makes the difference worth having. Measured over
// HTTP/2 on a 1.6Mb/s link with 150ms of latency, a cold load went from 1569ms and 130kB across
// 34 requests to 578ms and 41kB across two.
//
// No source maps. The deployed copy is the small one and the readable one is `src`, which is what
// every other way into this game already uses: index.html loads src/main.js, the tests import the
// modules directly, and tools/screenshot.mjs drives the page off src.
async function bundle() {
  for (const entry of ENTRIES) {
    if (!fs.existsSync(path.join(ROOT, entry))) {
      throw new Error(`${entry} is not there, so nothing would be bundled for it`)
    }
  }
  await esbuild.build({
    entryPoints: ENTRIES.map((entry) => path.join(ROOT, entry)),
    outdir: path.join(out, scripts),
    // Relative to src, so src/guide/main.js lands at <scripts>/guide/main.js and not at
    // <scripts>/main.js beside the game's.
    outbase: path.join(ROOT, "src"),
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    // The copy is already there; this writes over the entry points and leaves the rest.
    allowOverwrite: true,
    logLevel: "warning",
  })
  // What is left of the copy that nothing asks for any more: every module that was folded into a
  // bundle. Anything not reachable by an import stays, which is the fonts.
  const reachable = new Set(
    ENTRIES.map((entry) => path.join(out, scripts, path.relative("src", entry))),
  )
  let dropped = 0
  const sweep = (dir) => {
    for (const found of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, found.name)
      if (found.isDirectory()) {
        sweep(at)
        if (fs.readdirSync(at).length === 0) {
          fs.rmdirSync(at)
        }
      } else if (found.name.endsWith(".js") && !reachable.has(at)) {
        fs.rmSync(at)
        dropped++
      }
    }
  }
  sweep(path.join(out, scripts))
  return dropped
}

const folded = await bundle()

for (const asset of ASSETS) {
  const from = path.join(ROOT, asset)
  if (!fs.existsSync(from)) {
    throw new Error(`${asset} is missing: run tools/screenshot.mjs`)
  }
  fs.mkdirSync(path.dirname(path.join(out, asset)), { recursive: true })
  fs.copyFileSync(from, path.join(out, asset))
}

let page = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")

// The one reference that has to move. Asserted rather than assumed: a page that quietly
// keeps pointing at src/ would deploy and would serve yesterday's game from a cache.
const entry = 'src="src/main.js"'
if (!page.includes(entry)) {
  throw new Error("index.html no longer loads src/main.js, so nothing was versioned")
}
page = page.replace(entry, `src="${scripts}/main.js"`)

// The editor and the strategy guide go up with it. Neither is part of the game, and both are
// built out of the same modules it is - which are already up there under the versioned directory.
for (const { file, entry } of PAGES) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8")
  const reference = `src="${entry}"`
  if (!source.includes(reference)) {
    throw new Error(`${file} no longer loads ${entry}`)
  }
  fs.writeFileSync(
    path.join(out, file),
    source.replace(reference, `src="${scripts}/${entry.replace(/^src\//, "")}"`),
  )
}

// Absolute URLs, for the readers that will not take a relative one: Open Graph, and the
// canonical link. The card gets the version as well, so a new picture is a new URL rather
// than whatever a platform cached the first time it saw the old one.
if (base && base !== HOME) {
  page = page.split(HOME).join(base)
}
page = page.replace('social.png"', `social.png?v=${version}"`)

// Which version this is, for anyone who has to ask what a player is running.
page = page.replace("<title>", `<meta name="version" content="${version}" />\n    <title>`)

fs.writeFileSync(path.join(out, "index.html"), page)

const shipped = ENTRIES.map((entry) => {
  const at = path.join(out, scripts, path.relative("src", entry))
  return { name: path.relative("src", entry), bytes: fs.statSync(at).size }
})
const total = shipped.reduce((sum, { bytes }) => sum + bytes, 0)
console.log(
  `built ${path.relative(ROOT, out)}: ${shipped.length} bundles under ${scripts}, ` +
    `${folded} modules folded into them, plus ${PAGES.map(({ file }) => file).join(" and ")}`,
)
for (const { name, bytes } of shipped) {
  console.log(`  ${name.padEnd(16)} ${(bytes / 1024).toFixed(1)}kB`)
}
console.log(`  ${String(total / 1024 > 0 ? (total / 1024).toFixed(1) : 0).padStart(16)}kB in all`)
console.log(`  base ${base || "(relative)"}`)
