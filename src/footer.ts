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

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number; input: number; output: number; cacheRead: number; cacheWrite: number };
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** Per-component spend, so the dominant cost driver can be highlighted. */
	costParts: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

function fmt(n: number) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

function totals(ctx: ExtensionContext): Totals {
	const t: Totals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		costParts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		const u = (e.message as { usage?: Usage }).usage;
		if (!u) continue;
		t.input += u.input;
		t.output += u.output;
		t.cacheRead += u.cacheRead ?? 0;
		t.cacheWrite += u.cacheWrite ?? 0;
		t.cost += u.cost?.total ?? 0;
		t.costParts.input += u.cost?.input ?? 0;
		t.costParts.output += u.cost?.output ?? 0;
		t.costParts.cacheRead += u.cost?.cacheRead ?? 0;
		t.costParts.cacheWrite += u.cost?.cacheWrite ?? 0;
	}
	return t;
}

/**
 * Build styled telemetry segments. The component with the highest share
 * of session spend is highlighted in the accent color — that's where
 * your money is going (usually cache reads: the whole conversation is
 * re-read from cache every turn, so small ctx = smaller bill).
 */
function telemetryLine(t: Totals, theme: Theme) {
	if (t.input === 0) return "";
	const segments: { text: string; cost: number }[] = [
		{ text: `in ${fmt(t.input)}`, cost: t.costParts.input },
		{ text: `out ${fmt(t.output)}`, cost: t.costParts.output },
	];
	if (t.cacheRead > 0) segments.push({ text: `cached ${fmt(t.cacheRead)}`, cost: t.costParts.cacheRead });
	if (t.cacheWrite > 0) segments.push({ text: `stored ${fmt(t.cacheWrite)}`, cost: t.costParts.cacheWrite });

	const top = segments.reduce((a, b) => (b.cost > a.cost ? b : a));
	const styled = segments.map((s) => theme.fg(s === top && s.cost > 0 ? "accent" : "dim", s.text));
	styled.push(theme.fg("dim", `$${t.cost.toFixed(2)}`));
	return styled.join(theme.fg("dim", "  "));
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
					const model = ctx.model?.id ?? "no-model";
					const left = theme.fg("dim", branch ? `${dir} ${branch} · ${model}` : `${dir} · ${model}`);
					const metrics = telemetryLine(t, theme);
					const right = [metrics, statuses].filter(Boolean).join("  ");

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	});
}
