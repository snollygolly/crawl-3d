// House style, shared by every block below: tabs, double quotes, semicolons.
const rules = {
	"comma-dangle": 2,
	"no-underscore-dangle": 0,
	"no-else-return": 2,
	"no-self-compare": 2,
	"no-throw-literal": 2,
	"wrap-iife": [2, "outside"],
	"no-catch-shadow": 2,
	"indent": [2, "tab"],
	"consistent-this": [2, "self"],
	"func-names": 2,
	"no-inline-comments": 2,
	"max-nested-callbacks": [2, 3],
	"new-cap": 2,
	"new-parens": 2,
	"no-array-constructor": 2,
	"no-multiple-empty-lines": 2,
	"no-nested-ternary": 2,
	"one-var": [2, "never"],
	"operator-assignment": [2, "always"],
	"quotes": [2, "double", "avoid-escape"],
	"semi": [2, "always"],
	"spaced-comment": [1, "always"],
	"keyword-spacing": 2,
	"space-infix-ops": 2,
	"space-in-parens": [2, "never"],
	"space-before-function-paren": [2, "never"],
	"space-before-blocks": [2, "always"],
	"no-var": 2,
	"prefer-const": 1,
	"prefer-template": 1,
	"require-await": 1,
	"arrow-spacing": 2,
	"generator-star-spacing": [2, "after"],
	"no-confusing-arrow": 2,
	"no-const-assign": 2
};

const nodeGlobals = {
	process: "readonly",
	Buffer: "readonly",
	console: "readonly",
	setTimeout: "readonly",
	clearTimeout: "readonly"
};

module.exports = [
	{
		ignores: [
			"node_modules",
			"coverage",
			"dist/**",
			"test-results/**",
			"playwright-report/**",
			"blob-report/**",
			// Stock WebTiles client code from Crawl, kept as upstream wrote it.
			"web/vendor-client/**",
			"web/overrides/**",
			"vendor/**",
			"engine-build/**"
		]
	},
	{
		// Node-side CommonJS: tests, e2e specs, and the Playwright/ESLint configs.
		files: ["**/*.js", "**/*.cjs"],
		ignores: ["web/**"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "commonjs",
			globals: {
				...nodeGlobals,
				require: "readonly",
				module: "readonly",
				exports: "readonly",
				__dirname: "readonly",
				__filename: "readonly"
			}
		},
		rules
	},
	{
		// Node-side ES modules: config.mjs and the scripts.
		files: ["**/*.mjs"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...nodeGlobals,
				fetch: "readonly",
				URL: "readonly"
			}
		},
		rules
	},
	{
		// Node tests also use fetch.
		files: ["test/**/*.js"],
		languageOptions: {
			globals: { fetch: "readonly" }
		}
	},
	{
		// Our client code: plain browser scripts and RequireJS (AMD) modules that run alongside the
		// stock WebTiles client, plus the engine's Web Worker. They're served as-is, not bundled.
		files: ["web/src/**/*.js"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "script",
			globals: {
				window: "readonly",
				document: "readonly",
				navigator: "readonly",
				location: "readonly",
				console: "readonly",
				localStorage: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				performance: "readonly",
				Worker: "readonly",
				Image: "readonly",
				ResizeObserver: "readonly",
				define: "readonly",
				requirejs: "readonly",
				THREE: "readonly",
				self: "readonly",
				importScripts: "readonly",
				postMessage: "readonly",
				Module: "readonly"
			}
		},
		rules: {
			...rules,
			// AMD modules and Emscripten hooks are anonymous callbacks throughout.
			"func-names": 0
		}
	}
];
