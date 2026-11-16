// Retries for bucket uploads. The hub's bucket throttles bursts ("SlowDown: Please reduce your
// request rate"); those are worth waiting out, anything else fails the upload at once.
const THROTTLE_NAMES = new Set([
	"SlowDown", "Throttling", "ThrottlingException", "TooManyRequestsException", "RequestLimitExceeded"
]);

export function isThrottle(err) {
	if (!err) return false;
	if (THROTTLE_NAMES.has(err.name) || THROTTLE_NAMES.has(err.Code)) return true;
	const status = err.$metadata?.httpStatusCode;
	return status === 429 || status === 503;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Calls fn() until it resolves, retrying throttle errors up to `attempts` calls in all, with
// exponential backoff (baseMs, 2*baseMs, ... capped at maxMs) plus up to 25% jitter.
export async function withRetry(fn, opts = {}) {
	const { attempts = 5, baseMs = 1000, maxMs = 30000, sleep = wait, onRetry = () => {}, random = Math.random } = opts;
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await fn();
		} catch (err) {
			if (attempt >= attempts || !isThrottle(err)) throw err;
			const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
			const ms = Math.round(delay * (1 + random() / 4));
			onRetry(err, attempt, ms);
			await sleep(ms);
		}
	}
}
