// Smoke test: start a game, make a character, walk, check the 3D view runs.
//   npm run dev                       (in another terminal)
//   npx playwright install chromium   (once)
//   npm run test:smoke                (URL=... to test a deployed site)
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, what, secs = 120) {
    for (let i = 0; i < secs * 2; i++) {
        if (await page.evaluate(fn)) return;
        await sleep(500);
    }
    throw new Error("timed out waiting for " + what);
}

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || undefined,
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const t0 = Date.now();

    await page.goto(URL + (URL.includes("?") ? "&" : "?") + "seed=42");
    await page.fill("#crawl3d_name", "Smoke");
    await page.click("#crawl3d_play");
    await waitFor(page, () => !!document.querySelector("#ui-stack > *"), "species menu");
    console.log(`menu after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    for (const k of ["b", "a", "c"]) {   // Minotaur, Fighter, war axe
        await page.keyboard.press(k);
        await sleep(1200);
    }
    await waitFor(page, () => {
        const t = document.getElementById("stats_time");
        return t && t.textContent.trim() !== "";
    }, "game start");
    await sleep(1500);

    const active = await page.evaluate(() =>
        requirejs("game-local/three_view").is_active()
        && !!document.querySelector("#three_view canvas"));
    if (!active) throw new Error("3D view is not running");

    // Walk away from the stairs; at least one step should take a turn.
    for (const k of ["j", "j", "l", "h", "k", "k"]) {
        await page.keyboard.press(k);
        await sleep(400);
    }
    await sleep(1000);
    const time = await page.evaluate(() => document.getElementById("stats_time").textContent);
    if (time.trim().startsWith("0.0")) throw new Error("no turns passed after moving");

    await page.screenshot({ path: "smoke.png" });
    await browser.close();
    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
    console.log(`ok: game time ${time.trim()}, screenshot smoke.png`);
})().catch((e) => {
    console.error("SMOKE FAILED:", e.message);
    process.exit(1);
});
