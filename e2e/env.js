"use strict";

// Shared by playwright.config.js (the server it boots) and anything else e2e that needs to know
// where that server lives. Its own port keeps test runs clear of a running `npm start`; the env
// keys are the ones config.mjs reads.
const PORT = 5055;

const TEST_ENV = {
	PORT: String(PORT),
	HOST: "127.0.0.1"
};

module.exports = { PORT, TEST_ENV };
