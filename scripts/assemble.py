#!/usr/bin/env python3
"""Assemble the deployable site in dist/ from:

  web/vendor-client/   stock WebTiles client from Crawl (static/, gamedata/, templates/)
  web/overrides/       our edited copies of stock client files (win over vendor-client)
  web/src/             our code: 3D view, worker, fake socket, start screen
  public/              favicons and the hub's thumb.png, copied to the root as-is
  node_modules/three/  three.js
  evilmouse.json       title and source link

The engine bundle is NOT copied in. It's built locally (scripts/build-engine.sh), uploaded to
the hub bucket with `npm run upload-engine`, and loaded at runtime from ENGINE_URL below, which
the hub serves same-origin (spa-hub's /.hub/files/ route) and scripts/serve.mjs serves from
engine-build/ locally. That keeps the build free of secrets and of the 46 MB engine.

Usage: python3 scripts/assemble.py [--out dist]
"""
import argparse, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
VC = os.path.join(WEB, "vendor-client")

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
args = ap.parse_args()
OUT = args.out

engine = json.load(open(os.path.join(ROOT, "engine.json")))
game_meta = json.load(open(os.path.join(ROOT, "evilmouse.json")))
TITLE = game_meta["title"]
SOURCE_URL = game_meta["links"]["github"]
THREE = os.path.join(ROOT, "node_modules", "three", "build")
PUBLIC = os.path.join(ROOT, "public")

# Where the engine bundle (crawl.js/.wasm/.data and gamedata/) is served from, absolute because
# the hub serves the game from the root of its subdomain. Must match upload-engine.mjs's key.
ENGINE_URL = "/.hub/files/engine/" + engine["build"]

# Client modules the engine build generates (tile sheet indexes). They live in the engine bundle's
# gamedata/, not in web/vendor-client, so RequireJS is pointed at the engine for each one. If a
# Crawl upgrade adds or renames one, it shows up as a 404 in the e2e smoke spec.
GENERATED_MODULES = ["tileinfo-floor", "tileinfo-wall", "tileinfo-feat", "tileinfo-player",
                     "tileinfo-main", "tileinfo-gui", "tileinfo-icons", "tileinfo-dngn",
                     "status-icon-sizes"]

if not os.path.exists(os.path.join(THREE, "three.module.js")):
    sys.exit("missing node_modules/three (run npm install)")

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

def copytree(src, dst):
    shutil.copytree(src, dst, dirs_exist_ok=True)

# Stock client, then our overrides on top
copytree(os.path.join(VC, "static"), os.path.join(OUT, "static"))
copytree(os.path.join(VC, "gamedata"), os.path.join(OUT, "gamedata"))
copytree(os.path.join(WEB, "overrides"), OUT)
copytree(PUBLIC, OUT)
for f in ["three_view.js", "hud.js", "tile_names.js"]:
    shutil.copy(os.path.join(WEB, "src", f), os.path.join(OUT, "gamedata"))

# app.js uses absolute paths; make them relative so the site works in a subfolder
app_path = os.path.join(OUT, "static", "scripts", "app.js")
app = open(app_path).read()
app = app.replace("baseUrl: '/static/scripts'", "baseUrl: 'static/scripts'")
app = app.replace("'jquery': '/static/scripts/contrib/jquery'", "'jquery': 'contrib/jquery'")
open(app_path, "w").write(app)

# game.html, rendered the way the Python WebTiles server would
game = open(os.path.join(VC, "templates", "game.html")).read()
# Generated modules and tile sheets come from the engine bundle; the rest of gamedata/ is ours
paths = {"game-local": "../../gamedata"}
for m in GENERATED_MODULES:
    paths["game-local/" + m] = ENGINE_URL + "/gamedata/" + m
game = game.replace('paths: { "game-{{ version }}": "/gamedata/{{ version }}" },',
                    "paths: " + json.dumps(paths) + ",")
game, n = re.subn(r'src="/gamedata/{{ version }}/(\w+\.png)"',
                  lambda m: 'src="%s/gamedata/%s"' % (ENGINE_URL, m.group(1)), game)
assert n >= 7, "expected the tile sheet <img>s in game.html, found %d" % n
game = game.replace("/gamedata/{{ version }}", "gamedata")
game = game.replace("{{ version }}", "local")
assert "{{" not in game and "{%" not in game
open(os.path.join(OUT, "gamehtml.js"), "w").write(
    "window.CRAWL3D_GAME_HTML = " + json.dumps(game) + ";\n")

# client.html -> index.html: drop the Tornado template logic
html = open(os.path.join(VC, "templates", "client.html")).read()
out, depth, pos = [], 0, 0
for m in re.finditer(r"{%\s*(\w+)[^%]*%}", html):
    if depth == 0:
        out.append(html[pos:m.start()])
    if m.group(1) == "if":
        depth += 1
    elif m.group(1) == "end":
        depth -= 1
    pos = m.end()
out.append(html[pos:])
html = "".join(out)
html = re.sub(r'{{\s*static_url\("([^"]+)"\)\s*}}', r"static/\1", html)
html = re.sub(r'<script type="text/javascript">.*?</script>', "", html, count=1, flags=re.S)
html = html.replace('data-main="/static/scripts/app"', 'data-main="static/scripts/app"')
html = html.replace('href="/static/', 'href="static/')
html = re.sub(r'\s*<img style="display:none;"[^>]*title_[^>]*>', "", html)  # lobby art
assert "{{" not in html and "{%" not in html, re.findall(r"{[{%].*", html)[:3]

head_extra = """
    <script>var socket_server = "local"; var game_version = "";</script>
    <script>
      // Caches the engine per build (sw.js). Needs https or localhost; elsewhere it just downloads.
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("sw.js", e); });
    </script>
    <script type="module">
      import * as THREE from "./three/three.module.js";
      window.THREE = THREE;
    </script>
    <script src="gamehtml.js"></script>
    <script src="fakesocket.js"></script>
    <link rel="stylesheet" type="text/css" href="crawl3d.css">
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <link rel="apple-touch-icon" href="apple-touch-icon.png">
"""
html = html.replace("<title>WebTiles - Dungeon Crawl Stone Soup</title>",
                    "<title>%s - a fan client for Dungeon Crawl Stone Soup</title>" % TITLE
                    + head_extra, 1)
html = html.replace('<meta name="viewport" content="width=860, initial-scale=1.0">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1.0">')
start = open(os.path.join(WEB, "src", "start.html")).read()
start = start.replace("{{SOURCE_URL}}", SOURCE_URL)
html = html.replace("<body>", "<body>\n" + start, 1)
open(os.path.join(OUT, "index.html"), "w").write(html)

for f in ["fakesocket.js", "crawl3d.css"]:
    shutil.copy(os.path.join(WEB, "src", f), OUT)

os.makedirs(os.path.join(OUT, "three"))
for f in ["three.module.js", "three.core.js"]:
    shutil.copy(os.path.join(THREE, f), os.path.join(OUT, "three"))

# engine/worker.js, pointed at the engine bundle
os.makedirs(os.path.join(OUT, "engine"))
worker = open(os.path.join(WEB, "src", "worker.js")).read()
assert "__ENGINE_URL__" in worker
open(os.path.join(OUT, "engine", "worker.js"), "w").write(
    worker.replace("__ENGINE_URL__", ENGINE_URL))

# sw.js, which caches that engine build in the browser. At the root, so its scope is the site.
sw = open(os.path.join(WEB, "src", "sw.js")).read()
assert "__ENGINE_URL__" in sw and "__ENGINE_BUILD__" in sw
open(os.path.join(OUT, "sw.js"), "w").write(
    sw.replace("__ENGINE_URL__", ENGINE_URL).replace("__ENGINE_BUILD__", engine["build"]))

shutil.copy(os.path.join(ROOT, "LICENSE"), OUT)
print("assembled %s (engine %s)" % (os.path.relpath(OUT, ROOT), engine["build"]))
