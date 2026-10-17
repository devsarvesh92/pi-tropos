/**
 * Sessions — clean browser for pi's persisted sessions + auto-naming.
 *
 * Pi already persists every session to ~/.pi/agent/sessions. This adds:
 *
 *   /sessions       pick from this project's sessions (newest first)
 *   /sessions all   pick from every project's sessions
 *
 * Sessions without a name are auto-named from the first user message
 * after the first turn, so the picker stays readable.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, SessionInfo } from "@earendil-works/pi-coding-agent";

const TITLE_MAX = 60;

function oneLine(text: string, max: number) {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function ago(date: Date) {
	const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return date.toISOString().slice(0, 10);
}

function title(s: SessionInfo) {
	return oneLine(s.name ?? s.firstMessage ?? "(empty)", TITLE_MAX);
}

export default function sessions(pi: ExtensionAPI) {
	// Auto-name: after each turn, if the session is unnamed, name it
	// from the first user message.
	pi.on("turn_end", (_event, ctx) => {
		if (pi.getSessionName()) return;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			const content = entry.message.content;
			const text =
				typeof content === "string"
					? content
					: content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join(" ");
			if (text) pi.setSessionName(oneLine(text, 50));
			return;
		}
	});

	pi.registerCommand("sessions", {
		description: "Browse and switch sessions — /sessions [all]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/sessions needs interactive mode", "error");
				return;
			}

			const all = args.trim() === "all";
			const current = ctx.sessionManager.getSessionFile();

			const list = (all ? await SessionManager.listAll() : await SessionManager.list(ctx.cwd))
				.filter((s) => s.path !== current && s.messageCount > 0)
				.sort((a, b) => b.modified.getTime() - a.modified.getTime());

			if (list.length === 0) {
				ctx.ui.notify(all ? "No sessions found" : "No sessions for this project — try /sessions all", "info");
				return;
			}

			const labels = list.map((s) => {
				const where = all ? `[${s.cwd.split("/").pop() ?? "?"}] ` : "";
				return `${ago(s.modified)} · ${where}${title(s)} (${s.messageCount})`;
			});

			const choice = await ctx.ui.select(all ? "All sessions" : "Sessions in this project", labels);
			if (choice === undefined) return;

			const target = list[labels.indexOf(choice)];
			const { cancelled } = await ctx.switchSession(target.path, {
				withSession: async (rctx) => {
					rctx.ui.notify(`Resumed: ${title(target)}`, "info");
				},
			});
			if (cancelled) ctx.ui.notify("Switch cancelled", "info");
		},
	});
}
