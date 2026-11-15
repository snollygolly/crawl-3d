"use strict";

const base = require("@playwright/test");

// Specs import { test, expect } from here rather than @playwright/test, so shared setup lives in one
// place as fixtures - created only for the tests that ask for them, and torn down even on failure.
const test = base.test.extend({
	// A second person on their own device: a fresh context (own cookies and localStorage), picked up
	// with this project's device options from the config.
	guest: async({ browser }, use) => {
		const context = await browser.newContext();
		await use(await context.newPage());
		await context.close();
	}
});

module.exports = { test, expect: base.expect };
