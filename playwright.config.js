"use strict";

const { defineConfig, devices } = require("@playwright/test");
const { PORT, TEST_ENV } = require("./e2e/env");

const baseURL = `http://localhost:${PORT}`;

module.exports = defineConfig({
	testDir: "e2e",
	timeout: 30000,
	retries: process.env.CI ? 1 : 0,
	// A broken build shouldn't spend the whole CI job timing out spec after spec.
	maxFailures: process.env.CI ? 10 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "on-first-retry"
	},
	// Desktop WebKit only: Crawl's UI is keyboard-driven. The phone layout is tested from this
	// project too, with a phone-sized touch viewport (e2e/mobile.spec.js).
	// Never Chromium (see CLAUDE.md).
	projects: [
		{ name: "desktop-webkit", use: { ...devices["Desktop Safari"] } }
	],
	// `npm run test:e2e` builds first (pretest:e2e), then this serves dist/ plus the local engine
	// bundle at the URL the hub serves it from.
	webServer: {
		command: "node scripts/serve.mjs",
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
		env: TEST_ENV
	}
});
