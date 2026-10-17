/**
 * Footer — clean one-line status bar + /zen mode.
 *
 * Normal: `project branch` left; `↑in ↓out Rcache Wcache $cost` + extension
 * statuses (e.g. the dumbzone ctx gauge) right. Zero-valued counters hide.
 *
 * /zen:  collapses all tool output and shrinks the footer to just
 * `$cost` + the ctx gauge. Reading mode for brainstorming — the chat
 * becomes the content. /zen again restores your previous state.
 * (Zen lives here because the footer owns the chrome it minimizes.)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function fmt(n: number) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

function totals(ctx: ExtensionContext): Totals {
	const t: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		const u = (e.message as { usage?: Usage }).usage;
		if (!u) continue;
		t.input += u.input;
		t.output += u.output;
		t.cacheRead += u.cacheRead ?? 0;
		t.cacheWrite += u.cacheWrite ?? 0;
		t.cost += u.cost?.total ?? 0;
	}
	return t;
}

function telemetryLine(t: Totals) {
	if (t.input === 0) return "";
	const parts = [`↑${fmt(t.input)}`, `↓${fmt(t.output)}`];
	if (t.cacheRead > 0) parts.push(`R${fmt(t.cacheRead)}`);
	if (t.cacheWrite > 0) parts.push(`W${fmt(t.cacheWrite)}`);
	parts.push(`$${t.cost.toFixed(2)}`);
	return parts.join(" ");
}

let zen = false;
let wasExpanded = true;

export default function footer(pi: ExtensionAPI) {
	pi.registerCommand("zen", {
		description: "Toggle zen mode — collapse tool noise, minimal footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/zen needs interactive mode", "error");
				return;
			}
			zen = !zen;
			if (zen) {
				wasExpanded = ctx.ui.getToolsExpanded();
				ctx.ui.setToolsExpanded(false);
				ctx.ui.notify("Zen ☁️ — Ctrl+T hides thinking · /zen to exit", "info");
			} else {
				ctx.ui.setToolsExpanded(wasExpanded);
				ctx.ui.notify("Zen off — full telemetry restored", "info");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		zen = false;
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const t = totals(ctx);
					const statuses = [...footerData.getExtensionStatuses().values()].join(" ");

					if (zen) {
						const right = [t.cost > 0 ? `$${t.cost.toFixed(2)}` : "", statuses].filter(Boolean).join("  ");
						return [truncateToWidth(theme.fg("dim", right), width)];
					}

					const dir = ctx.cwd.split("/").pop() ?? ctx.cwd;
					const branch = footerData.getGitBranch();
					const left = theme.fg("dim", branch ? `${dir} ${branch}` : dir);
					const metrics = theme.fg("dim", telemetryLine(t));
					const right = [metrics, statuses].filter(Boolean).join("  ");

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	});
}
