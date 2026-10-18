/**
 * TDD lock — makes test-first mechanically true instead of merely requested.
 *
 * Telling a model "write tests first" does not work: it agrees, then writes
 * the implementation anyway and backfills tests. So we take the door away.
 *
 *   RED    edits to source files are blocked. Only tests can be written.
 *          Leaves RED when the test command actually exits non-zero.
 *   GREEN  edits to test files are blocked — tests are frozen, so passing
 *          them means implementing, not weakening them. Leaves GREEN when
 *          the test command exits zero.
 *
 * Phase advances only on a real exit code from a real run (`tdd_check`),
 * never on the model's claim that it ran them. Non-code files (docs, config)
 * are never blocked: the guarantee is test-before-implementation ordering,
 * not a frozen repo.
 *
 *   /tdd on [command]   engage (auto-detects the test command)
 *   /tdd off            disengage
 *   /tdd red|green      force a phase (e.g. a test itself was wrong)
 *   /tdd                status
 *
 * /tdd is a user command, not a tool — the model cannot unlock itself.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Phase = "off" | "red" | "green";

interface TddState {
	phase: Phase;
	/** Shell command whose exit code drives phase transitions. */
	testCommand: string;
	/** Set once the current RED has been witnessed failing, for the status line. */
	sawFailure: boolean;
}

const STATUS_KEY = "tdd";

// A file is "source" if it is code and is not a test. Everything else —
// markdown, json, yaml, lockfiles — is never blocked.
const CODE_EXT =
	/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|scala|ex|exs|clj|dart|m|mm)$/i;

const TEST_PATTERNS = [
	/(^|\/)(tests?|spec|__tests__|__specs__)\//i, // test/ tests/ spec/ __tests__/
	/\.(test|spec)\.[^/]+$/i, // foo.test.ts, foo.spec.js
	/(^|\/)test_[^/]+$/i, // test_foo.py
	/_test\.[^/]+$/i, // foo_test.go, foo_test.py
	/_spec\.[^/]+$/i, // foo_spec.rb
];

/** Best-effort detection of bash commands that mutate files behind our back. */
const BASH_MUTATORS = [/\bsed\s+-i\b/, /\bperl\s+-[a-z]*i\b/, /\btee\s+/, /(^|[^>])>>?\s*[^>|\s]+/];

export function isTestPath(p: string): boolean {
	const norm = p.replace(/\\/g, "/");
	return TEST_PATTERNS.some((re) => re.test(norm));
}

export function isSourcePath(p: string): boolean {
	return CODE_EXT.test(p) && !isTestPath(p);
}

/**
 * Detect the repo's own test command. We never invent one: if nothing is
 * found the lock refuses to engage rather than guessing, because a wrong
 * command would make every phase transition meaningless.
 */
function detectTestCommand(cwd: string): string | undefined {
	const pkg = join(cwd, "package.json");
	if (existsSync(pkg)) {
		try {
			const scripts = JSON.parse(readFileSync(pkg, "utf-8")).scripts ?? {};
			for (const name of ["test:unit", "test"]) if (scripts[name]) return `npm run ${name}`;
		} catch {
			// malformed package.json — fall through to the other detectors
		}
	}
	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini"))) return "pytest";
	if (existsSync(join(cwd, "go.mod"))) return "go test ./...";
	if (existsSync(join(cwd, "Cargo.toml"))) return "cargo test";
	return undefined;
}

/** Run the test command. Exit code is the only signal we trust. */
function runTests(cmd: string, cwd: string): { passed: boolean; output: string } {
	try {
		const output = execSync(cmd, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
		return { passed: true, output };
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; message: string };
		return { passed: false, output: (err.stdout ?? "") + (err.stderr ?? "") || err.message };
	}
}

function tail(output: string, lines = 30): string {
	return output.split("\n").slice(-lines).join("\n").trim();
}

function updateStatus(ctx: ExtensionContext | undefined, state: TddState) {
	if (!ctx?.hasUI) return;
	const theme = ctx.ui.theme;
	if (state.phase === "off") {
		ctx.ui.setStatus(STATUS_KEY, "");
		return;
	}
	const label = state.phase === "red" ? "tdd red" : "tdd green";
	ctx.ui.setStatus(STATUS_KEY, theme.fg(state.phase === "red" ? "error" : "success", label));
}

const BLOCK_RED = (path: string, cmd: string) =>
	`Blocked by the TDD lock: '${path}' is a source file and the phase is RED. ` +
	"Write a test that fails for the behaviour you are about to implement, then call tdd_check " +
	`(it runs \`${cmd}\` and reads the exit code). Source edits unlock once a test actually fails. ` +
	"Only the user can lift this, with /tdd off.";

const BLOCK_GREEN = (path: string) =>
	`Blocked by the TDD lock: '${path}' is a test file and the phase is GREEN. ` +
	"The tests are frozen so that making them pass means implementing the behaviour, not weakening the test. " +
	"Edit source files instead. If a test is genuinely wrong, say so and ask the user to run /tdd red.";

export default function tdd(pi: ExtensionAPI) {
	const state: TddState = { phase: "off", testCommand: "", sawFailure: false };
	let uiCtx: ExtensionContext | undefined;

	pi.on("session_start", (_event, ctx) => {
		// The lock is per-run, not persisted: a fresh session starts unlocked
		// unless something (e.g. /execute) turns it on deliberately.
		state.phase = "off";
		state.sawFailure = false;
		uiCtx = ctx;
		updateStatus(ctx, state);
	});

	// The gate. Everything else in this file is bookkeeping around it.
	pi.on("tool_call", async (event) => {
		if (state.phase === "off") return;

		for (const tool of ["edit", "write"] as const) {
			if (!isToolCallEventType(tool, event)) continue;
			const path = (event.input as { path?: string }).path ?? "";
			if (state.phase === "red" && isSourcePath(path)) {
				return { block: true, reason: BLOCK_RED(path, state.testCommand) };
			}
			if (state.phase === "green" && isTestPath(path)) {
				return { block: true, reason: BLOCK_GREEN(path) };
			}
			return;
		}

		// Best-effort: a model that cannot use `edit` may reach for `sed -i`
		// or a shell redirect. We cannot parse every shell construct, so this
		// catches the common ones and explains the real rule.
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			if (!BASH_MUTATORS.some((re) => re.test(command))) return;
			const target = state.phase === "red" ? isSourcePath : isTestPath;
			const words = command.split(/[\s"'`()<>|&;]+/).filter((w) => w.includes("."));
			if (words.some(target)) {
				return {
					block: true,
					reason:
						`Blocked by the TDD lock (${state.phase.toUpperCase()}): this command writes to a file the phase protects. ` +
						"Use the edit/write tools so the lock can see the path, and respect the current phase.",
				};
			}
		}
	});

	pi.registerTool({
		name: "tdd_check",
		label: "TDD Check",
		description:
			"Run the project's test command and advance the TDD phase from its exit code. " +
			"Call this after writing a failing test (to unlock source edits) and after implementing (to confirm green).",
		promptSnippet: "Run the tests and advance the TDD phase",
		promptGuidelines: [
			"While the TDD lock is engaged, call tdd_check to run tests and change phase; never claim tests were run without it.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (state.phase === "off") {
				return {
					content: [{ type: "text" as const, text: "The TDD lock is off; run tests however you like." }],
					details: { phase: "off" },
				};
			}

			const { passed, output } = runTests(state.testCommand, ctx.cwd);
			const before = state.phase;
			let message: string;

			if (before === "red" && !passed) {
				state.phase = "green";
				state.sawFailure = true;
				message =
					`Tests failed as required — RED satisfied. Phase is now GREEN: source edits are unlocked and ` +
					`test files are frozen. Implement until \`${state.testCommand}\` passes, then call tdd_check again.\n\n${tail(output)}`;
			} else if (before === "red" && passed) {
				message =
					"Tests PASSED, so there is no failing test yet — still RED. A test that passes before the " +
					"implementation exists is not testing the new behaviour. Write a test that fails first.\n\n" +
					tail(output, 10);
			} else if (passed) {
				message = `Tests pass — GREEN satisfied. Refactor if useful (tests stay frozen), then hand off.\n\n${tail(output, 10)}`;
			} else {
				message = `Still failing — keep implementing. Source edits remain unlocked.\n\n${tail(output)}`;
			}

			updateStatus(uiCtx, state);
			return {
				content: [{ type: "text" as const, text: message }],
				details: { phase: state.phase, passed, transitioned: before !== state.phase },
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("dim", "tdd ") + theme.fg("accent", "check"), 0, 0);
		},

		renderResult(result, _opts, theme) {
			const d = result.details as { phase?: Phase; passed?: boolean; transitioned?: boolean } | undefined;
			if (!d) return new Text(theme.fg("dim", "tdd check"), 0, 0);
			const verdict = d.passed ? theme.fg("success", "tests pass") : theme.fg("error", "tests fail");
			const phase = theme.fg("dim", ` · phase ${d.phase}`);
			return new Text(verdict + phase + (d.transitioned ? theme.fg("accent", " ✓ advanced") : ""), 0, 0);
		},
	});

	pi.registerCommand("tdd", {
		description: "TDD lock — /tdd on [command] · /tdd off · /tdd red|green · /tdd (status)",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);

			if (!sub) {
				const msg =
					state.phase === "off"
						? "TDD lock: off. /tdd on to engage."
						: `TDD lock: ${state.phase.toUpperCase()} · tests: ${state.testCommand}`;
				ctx.ui.notify(msg, "info");
				return;
			}

			if (sub === "off") {
				state.phase = "off";
				state.sawFailure = false;
				updateStatus(ctx, state);
				ctx.ui.notify("TDD lock off", "info");
				return;
			}

			if (sub === "on" || sub === "red" || sub === "green") {
				const override = rest.join(" ").trim();
				const command = override || state.testCommand || detectTestCommand(ctx.cwd) || "";
				if (!command) {
					ctx.ui.notify(
						"No test command found (looked for package.json scripts, pytest, go.mod, Cargo.toml). " +
							"Engage explicitly: /tdd on <command>",
						"error",
					);
					return;
				}
				state.testCommand = command;
				state.phase = sub === "green" ? "green" : "red";
				state.sawFailure = sub === "green";
				updateStatus(ctx, state);
				ctx.ui.notify(
					state.phase === "red"
						? `TDD lock RED — source edits blocked until a test fails · tests: ${command}`
						: `TDD lock GREEN — test files frozen · tests: ${command}`,
					"info",
				);
				return;
			}

			ctx.ui.notify("Usage: /tdd on [command] · /tdd off · /tdd red · /tdd green", "info");
		},
	});
}
