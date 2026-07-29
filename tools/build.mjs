// Build the site that gets published, which is the same files with two things done to them:
// the scripts are moved somewhere named after the commit, and the absolute URLs are pointed
// at wherever this copy is being published.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// The URL the tags in index.html are written with. Anything published somewhere else has
// these rewritten to its own base.
const HOME = "https://gadgetoid.github.io/dots"

// What goes up, besides the versioned scripts: the page, the card a link turns into, and the
// file that tells Pages not to run the whole thing through Jekyll.
const ASSETS = ["screenshots/social.png", ".nojekyll"]

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

// The scripts, under a directory named after the commit.
const scripts = path.join("v", version)
fs.cpSync(path.join(ROOT, "src"), path.join(out, scripts), { recursive: true })

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

const files = fs.readdirSync(path.join(out, scripts)).length
console.log(`built ${path.relative(ROOT, out)}: ${files} scripts under ${scripts}`)
console.log(`  base ${base || "(relative)"}`)
