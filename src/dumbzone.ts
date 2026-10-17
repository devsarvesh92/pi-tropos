/**
 * Dumbzone — context health indicator + /fresh handoff.
 *
 * Footer status shows context fill, colored by the 100k/40% rule:
 *   dim     below warn zone (< 80k tokens and < 32%)
 *   yellow  approaching the dumb zone (>= 80k tokens or >= 32%)
 *   red     dumb zone (>= 100k tokens or >= 40%) — quality degrades here
 *
 * Entering the dumb zone triggers a one-time nudge suggesting /fresh.
 *
 * /fresh summarizes the current session, lets you edit the summary,
 * then starts a new session with the summary as its first message.
 * The old session stays fully persisted and linked via parentSession.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DUMB_TOKENS = 100_000; // dumb zone: this many tokens...
const DUMB_PERCENT = 40; // ...or this much of the window, whichever hits first
const WARN_FRACTION = 0.8; // yellow from 80% of the dumb-zone line

const STATUS_KEY = "dumbzone";

function inDumbZone(tokens: number, percent: number) {
	return tokens >= DUMB_TOKENS || percent >= DUMB_PERCENT;
}

function inWarnZone(tokens: number, percent: number) {
	return tokens >= DUMB_TOKENS * WARN_FRACTION || percent >= DUMB_PERCENT * WARN_FRACTION;
}

function updateStatus(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	const theme = ctx.ui.theme;
	const usage = ctx.getContextUsage();

	if (!usage || usage.tokens === null || usage.percent === null) {
		ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "ctx —"));
		return;
	}

	const { tokens, percent } = usage;
	const color = inDumbZone(tokens, percent) ? "error" : inWarnZone(tokens, percent) ? "warning" : "dim";
	ctx.ui.setStatus(STATUS_KEY, theme.fg(color, `ctx ${Math.round(tokens / 1000)}k · ${Math.round(percent)}%`));
}

export default function dumbzone(pi: ExtensionAPI) {
	let nudged = false;

	pi.on("session_start", (_event, ctx) => {
		nudged = false;
		updateStatus(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		nudged = false;
		updateStatus(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		updateStatus(ctx);

		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null || usage.percent === null) return;

		if (inDumbZone(usage.tokens, usage.percent)) {
			if (!nudged) {
				nudged = true;
				ctx.ui.notify(
					`Dumb zone: ${Math.round(usage.tokens / 1000)}k tokens · ${Math.round(usage.percent)}% (100k/40% rule). Run /fresh to summarize & start a new session.`,
					"warning",
				);
			}
		} else {
			nudged = false;
		}
	});

	pi.registerCommand("fresh", {
		description: "Summarize this session, edit the summary, continue in a fresh session",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/fresh needs interactive mode", "error");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current run to finish", "warning");
				return;
			}

			const parentSession = ctx.sessionManager.getSessionFile();
			ctx.ui.notify("Summarizing session…", "info");

			ctx.compact({
				customInstructions:
					"Optimize for handoff to a fresh session: preserve decisions made, open questions, key file paths, and the current goal.",
				onComplete: async (result) => {
					const edited = await ctx.ui.editor(
						"Summary for the fresh session — edit freely, Esc to cancel",
						result.summary,
					);
					if (edited === undefined) {
						ctx.ui.notify("Stayed in current session", "info");
						return;
					}

					const summary = edited.trim();
					const { cancelled } = await ctx.newSession({
						parentSession: parentSession ?? undefined,
						setup: async (sm) => {
							sm.appendMessage({
								role: "user",
								content: [
									{
										type: "text",
										text: `This session continues from a previous one. Here is the summary of where we left off:\n\n${summary}\n\nContinue from here. Wait for my first instruction before doing work.`,
									},
								],
								timestamp: Date.now(),
							});
						},
						withSession: async (rctx) => {
							rctx.ui.notify("Fresh session — summary loaded", "info");
						},
					});
					if (cancelled) ctx.ui.notify("New session cancelled", "info");
				},
				onError: (error) => {
					ctx.ui.notify(`Summarization failed: ${error.message}`, "error");
				},
			});
		},
	});
}
