// worker.js -- runs the Crawl engine (compiled to wasm) in a Web Worker and
// plays the part of the WebTiles Python server: it batches the engine's JSON
// output for the client, and turns client messages into engine input.
"use strict";

// The engine lives in a per-build folder so browsers can cache it forever;
// scripts/assemble.py fills this in from engine.json.
var ENGINE_BUILD = "__ENGINE_BUILD__";

var queue = [];
var started = false;
var clientSent = false;
var exitInfo = { reason: "unknown", message: "" };

// Messages the Python server handles itself; never forward these to crawl.
var SERVER_ONLY = {
    go_lobby: 1, token_login: 1, login: 1, logout: 1, register: 1, play: 1,
    watch: 1, pong: 1, chat_msg: 1, get_rc: 1, set_rc: 1, stop_stale_process_purge: 1,
    force_terminate: 1, update_spectators: 1,
};

function flush()
{
    if (!queue.length) return;
    postMessage({ type: "msgs", data: '{"msgs":[' + queue.join(",") + "]}" });
    queue = [];
}
setInterval(flush, 50);

// Called from C++ (tileweb.cc) for every finished WebTiles message.
self.crawlOut = function (msg)
{
    if (msg.charAt(0) === "*")
    {
        var obj;
        try { obj = JSON.parse(msg.slice(1)); } catch (e) { return; }
        switch (obj.msg)
        {
        case "client_path":
            if (!clientSent)
            {
                clientSent = true;
                flush();
                postMessage({ type: "client", version: obj.version });
            }
            break;
        case "flush_messages":
            flush();
            break;
        case "exit_reason":
            exitInfo.reason = obj.type;
            exitInfo.message = obj.message || "";
            break;
        }
        return;
    }
    if (!clientSent && msg.indexOf('"msg":"version"') !== -1)
    {
        // Our build has no WEB_DIR_PATH, so crawl never sends "client_path";
        // its first real message is the version, so load the client then.
        clientSent = true;
        flush();
        postMessage({ type: "client" });
    }
    queue.push(msg);
    if (queue.length > 400) flush();
};

self.crawlInputQueue = [];

function handle_client_message(text)
{
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return; }
    if (SERVER_ONLY[obj.msg]) return;
    if (obj.msg === "input")
    {
        // Terminal input from the stock client (the Python server writes it
        // to crawl's pty). We run headless, so turn it into key messages.
        var codes = (obj.data || []).slice();
        for (var ch of (obj.text || ""))
            codes.push(ch.codePointAt(0));
        for (var i = 0; i < codes.length; i++)
            self.crawlInputQueue.push('{"msg":"key","keycode":' + codes[i] + "}");
        return;
    }
    self.crawlInputQueue.push(text);
}

var FS_ = null;
function sync_saves()
{
    if (!FS_) return;
    try { FS_.syncfs(false, function (err) { if (err) console.warn("save sync failed", err); }); }
    catch (e) {}
}

onmessage = function (ev)
{
    var m = ev.data;
    if (m.type === "start" && !started)
    {
        started = true;
        start_engine(m.name || "Adventurer", m.extra_args || []);
    }
    else if (m.type === "send" && started)
        handle_client_message(m.data);
};

// Copy files from src to dst, skipping any that already exist.
function seed_saves(FS, src, dst)
{
    if (!FS.analyzePath(src).exists) return;
    FS.readdir(src).forEach(function (f) {
        if (f === "." || f === "..") return;
        var s = src + "/" + f, d = dst + "/" + f;
        if (FS.isDir(FS.stat(s).mode))
        {
            if (!FS.analyzePath(d).exists) FS.mkdir(d);
            seed_saves(FS, s, d);
        }
        else if (!FS.analyzePath(d).exists)
            FS.writeFile(d, FS.readFile(s));
    });
}

function start_engine(name, extra_args)
{
    // The engine waits for an "attach" before it starts talking.
    self.crawlInputQueue.push('{"msg":"attach","primary":true}');

    self.Module = {
        arguments: ["-name", name, "-headless", "-webtiles-socket", "wasm",
                    "-await-connection"].concat(extra_args),
        noExitRuntime: false,
        locateFile: function (p) { return ENGINE_BUILD + "/" + p; },
        print: function (s) { console.log("[crawl]", s); },
        printErr: function (s) { console.warn("[crawl]", s); },
        setStatus: function (s) { if (s) postMessage({ type: "status", text: s }); },
        monitorRunDependencies: function (left) {
            postMessage({ type: "status", text: left ? "Loading game data..." : "Starting..." });
        },
        preRun: [function () {
            var FS = Module.FS;
            FS_ = FS;
            try { FS.mkdir("/saves"); } catch (e) {}
            FS.mount(FS.filesystems.IDBFS, {}, "/saves");
            Module.ENV.HOME = "/saves";
            Module.addRunDependency("idbfs");
            FS.syncfs(true, function (err) {
                if (err) console.warn("IDBFS load failed", err);
                // Crawl builds level-layout and text caches on first run,
                // which is slow in wasm; a prebuilt copy ships with the game.
                try { seed_saves(FS, "/crawl/seed", "/saves"); }
                catch (e) { console.warn("cache seeding failed", e); }
                Module.removeRunDependency("idbfs");
            });
        }],
        onExit: function (code) {
            flush();
            sync_saves();
            postMessage({ type: "exit", code: code, reason: exitInfo.reason,
                          message: exitInfo.message });
        },
        onAbort: function (what) {
            flush();
            sync_saves();
            postMessage({ type: "exit", code: -1, reason: "crash",
                          message: String(what) });
        },
    };
    setInterval(sync_saves, 5000);
    importScripts(ENGINE_BUILD + "/crawl.js");
}
