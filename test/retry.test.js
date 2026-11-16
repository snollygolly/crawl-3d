"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const lib = () => import("../scripts/lib/retry.mjs");

const slowDown = () => Object.assign(new Error("Please reduce your request rate."), { name: "SlowDown" });

test("tells throttling apart from other errors", async() => {
	const { isThrottle } = await lib();
	assert.ok(isThrottle(slowDown()));
	assert.ok(isThrottle({ name: "Error", Code: "ThrottlingException" }));
	assert.ok(isThrottle({ name: "Error", $metadata: { httpStatusCode: 503 } }));
	assert.ok(isThrottle({ name: "Error", $metadata: { httpStatusCode: 429 } }));
	assert.ok(!isThrottle({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
	assert.ok(!isThrottle(new Error("boom")));
	assert.ok(!isThrottle(undefined));
});

test("waits out throttling with growing, capped delays", async() => {
	const { withRetry } = await lib();
	const sleeps = [];
	const retries = [];
	let calls = 0;
	const result = await withRetry(() => {
		calls += 1;
		if (calls < 5) return Promise.reject(slowDown());
		return Promise.resolve("ok");
	}, {
		attempts: 5, baseMs: 100, maxMs: 300, random: () => 0,
		sleep: ms => { sleeps.push(ms); return Promise.resolve(); },
		onRetry: (err, attempt) => retries.push(`${err.name}#${attempt}`)
	});
	assert.strictEqual(result, "ok");
	assert.deepStrictEqual(sleeps, [100, 200, 300, 300]);
	assert.deepStrictEqual(retries, ["SlowDown#1", "SlowDown#2", "SlowDown#3", "SlowDown#4"]);
});

test("adds at most 25% jitter", async() => {
	const { withRetry } = await lib();
	const sleeps = [];
	let calls = 0;
	await withRetry(() => {
		calls += 1;
		return calls === 1 ? Promise.reject(slowDown()) : Promise.resolve();
	}, { baseMs: 1000, random: () => 0.999, sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
	assert.deepStrictEqual(sleeps, [1250]);
});

test("gives up after the last attempt", async() => {
	const { withRetry } = await lib();
	let calls = 0;
	await assert.rejects(withRetry(() => {
		calls += 1;
		return Promise.reject(slowDown());
	}, { attempts: 3, sleep: () => Promise.resolve() }), { name: "SlowDown" });
	assert.strictEqual(calls, 3);
});

test("fails at once on errors that aren't throttling", async() => {
	const { withRetry } = await lib();
	let calls = 0;
	await assert.rejects(withRetry(() => {
		calls += 1;
		return Promise.reject(new Error("AccessDenied"));
	}, { sleep: () => assert.fail("should not wait") }), /AccessDenied/);
	assert.strictEqual(calls, 1);
});
