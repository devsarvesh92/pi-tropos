/**
 * Footer — clean one-line status bar.
 *
 * Left:  project dir + git branch (dim)
 * Right: token & cost telemetry (dim, zero-values hidden) + extension
 *        statuses (e.g. the dumbzone ctx gauge, colored by health)
 *
 * Same data as the default footer, minus the noise: no full path, no
 * cache-hit %, no window size, no session title.
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

function fmt(n: number) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

function telemetry(ctx: ExtensionContext) {
	let input = 0,
		output = 0,
		cacheRead = 0,
		cacheWrite = 0,
		cost = 0;
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		const u = (e.message as { usage?: Usage }).usage;
		if (!u) continue;
		input += u.input;
		output += u.output;
		cacheRead += u.cacheRead ?? 0;
		cacheWrite += u.cacheWrite ?? 0;
		cost += u.cost?.total ?? 0;
	}
	if (input === 0) return "";
	const parts = [`↑${fmt(input)}`, `↓${fmt(output)}`];
	if (cacheRead > 0) parts.push(`R${fmt(cacheRead)}`);
	if (cacheWrite > 0) parts.push(`W${fmt(cacheWrite)}`);
	parts.push(`$${cost.toFixed(2)}`);
	return parts.join(" ");
}

export default function footer(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const dir = ctx.cwd.split("/").pop() ?? ctx.cwd;
					const branch = footerData.getGitBranch();
					const left = theme.fg("dim", branch ? `${dir} ${branch}` : dir);

					const stats = telemetry(ctx);
					const metrics = stats ? theme.fg("dim", stats) : "";
					const statuses = [...footerData.getExtensionStatuses().values()].join(" ");
					const right = [metrics, statuses].filter(Boolean).join("  ");

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	});
}
