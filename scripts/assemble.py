#!/usr/bin/env python3
"""Assemble the deployable site in dist/ from:

  web/vendor-client/   stock WebTiles client from Crawl (static/, gamedata/, templates/)
  web/overrides/       our edited copies of stock client files (win over vendor-client)
  web/src/             our code: 3D view, worker, fake socket, start screen
  engine-build/<build>/  the engine bundle named in engine.json
                         (from scripts/build-engine.sh or scripts/pull-engine.sh)
  node_modules/three/  three.js

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
site = json.load(open(os.path.join(ROOT, "site.json")))
ENGINE = os.path.join(ROOT, "engine-build", engine["build"])
THREE = os.path.join(ROOT, "node_modules", "three", "build")

for path, hint in [(os.path.join(ENGINE, "crawl.wasm"),
                    "run scripts/pull-engine.sh or scripts/build-engine.sh"),
                   (os.path.join(THREE, "three.module.js"), "run npm install")]:
    if not os.path.exists(path):
        sys.exit("missing %s (%s)" % (os.path.relpath(path, ROOT), hint))

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

def copytree(src, dst):
    shutil.copytree(src, dst, dirs_exist_ok=True)

# Stock client, then the generated tile files from the engine bundle, then
# our overrides on top
copytree(os.path.join(VC, "static"), os.path.join(OUT, "static"))
copytree(os.path.join(VC, "gamedata"), os.path.join(OUT, "gamedata"))
copytree(os.path.join(ENGINE, "gamedata"), os.path.join(OUT, "gamedata"))
copytree(os.path.join(WEB, "overrides"), OUT)
shutil.copy(os.path.join(WEB, "src", "three_view.js"), os.path.join(OUT, "gamedata"))

# app.js uses absolute paths; make them relative so the site works in a subfolder
app_path = os.path.join(OUT, "static", "scripts", "app.js")
app = open(app_path).read()
app = app.replace("baseUrl: '/static/scripts'", "baseUrl: 'static/scripts'")
app = app.replace("'jquery': '/static/scripts/contrib/jquery'", "'jquery': 'contrib/jquery'")
open(app_path, "w").write(app)

# game.html, rendered the way the Python WebTiles server would
game = open(os.path.join(VC, "templates", "game.html")).read()
game = game.replace('"/gamedata/{{ version }}" }', '"../../gamedata" }')
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
    <script type="module">
      import * as THREE from "./three/three.module.js";
      window.THREE = THREE;
    </script>
    <script src="gamehtml.js"></script>
    <script src="fakesocket.js"></script>
    <link rel="stylesheet" type="text/css" href="crawl3d.css">
"""
html = html.replace("<title>WebTiles - Dungeon Crawl Stone Soup</title>",
                    "<title>%s - a fan client for Dungeon Crawl Stone Soup</title>" % site["title"]
                    + head_extra, 1)
html = html.replace('<meta name="viewport" content="width=860, initial-scale=1.0">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1.0">')
start = open(os.path.join(WEB, "src", "start.html")).read()
start = start.replace("{{SOURCE_URL}}", site["sourceUrl"])
html = html.replace("<body>", "<body>\n" + start, 1)
open(os.path.join(OUT, "index.html"), "w").write(html)

for f in ["fakesocket.js", "crawl3d.css"]:
    shutil.copy(os.path.join(WEB, "src", f), OUT)

os.makedirs(os.path.join(OUT, "three"))
for f in ["three.module.js", "three.core.js"]:
    shutil.copy(os.path.join(THREE, f), os.path.join(OUT, "three"))

# engine/worker.js + engine/<build>/crawl.* (versioned, cacheable forever)
eng_out = os.path.join(OUT, "engine", engine["build"])
os.makedirs(eng_out)
worker = open(os.path.join(WEB, "src", "worker.js")).read()
assert "__ENGINE_BUILD__" in worker
open(os.path.join(OUT, "engine", "worker.js"), "w").write(
    worker.replace("__ENGINE_BUILD__", engine["build"]))
for f in ["crawl.js", "crawl.wasm", "crawl.data"]:
    shutil.copy(os.path.join(ENGINE, f), eng_out)

shutil.copy(os.path.join(ROOT, "LICENSE"), OUT)
print("assembled %s (engine %s)" % (os.path.relpath(OUT, ROOT), engine["build"]))
