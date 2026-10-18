/**
 * Peek — transient code viewer overlay. Leaves no trace in the chat.
 *
 *   /peek src/footer.ts     (/peek footer.ts finds it by basename too)
 *
 * Centered overlay: syntax-highlighted, line-numbered code. Scroll with
 * ↑/↓/jk, PgUp/PgDn, g/G, or the mouse wheel. Esc/q closes. Nothing is
 * appended to the transcript.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const MAX_BYTES = 200_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".pi"]);

/** Find files named `name` under `dir` (for forgiving path resolution). */
function findByBasename(dir: string, name: string, depth = 0): string[] {
	if (depth > 4) return [];
	const hits: string[] = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return hits;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) hits.push(...findByBasename(p, name, depth + 1));
		} else if (e.name === name) {
			hits.push(p);
		}
		if (hits.length > 5) break;
	}
	return hits;
}

export default function peek(pi: ExtensionAPI) {
	pi.registerCommand("peek", {
		description: "Peek at a file in a transient overlay — /peek <path>",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/peek needs interactive mode", "error");
				return;
			}
			// Strip surrounding quotes — users habitually paste 'paths' or "paths".
			const target = args.trim().replace(/^['"]|['"]$/g, "");
			if (!target) {
				ctx.ui.notify("Usage: /peek <path>", "info");
				return;
			}

			let path = isAbsolute(target) ? target : join(ctx.cwd, target);
			let content: string | undefined;
			try {
				if (!statSync(path).isFile()) throw new Error("not a file");
				if (statSync(path).size > MAX_BYTES) throw new Error("file too large");
				content = readFileSync(path, "utf-8");
			} catch {
				// Forgiving fallback: exact basename match anywhere in the project.
				const hits = findByBasename(ctx.cwd, basename(target));
				if (hits.length === 1) {
					path = hits[0];
					content = readFileSync(path, "utf-8");
				} else if (hits.length > 1) {
					ctx.ui.notify(`Ambiguous: ${hits.map((h) => relative(ctx.cwd, h)).join(", ")}`, "error");
					return;
				} else {
					ctx.ui.notify(`Cannot peek: ${target} not found`, "error");
					return;
				}
			}

			const rel = relative(ctx.cwd, path);
			const highlighted = highlightCode(content, getLanguageFromPath(path));
			const gutter = String(highlighted.length).length;

			await ctx.ui.custom(
				(tui, theme, _kb, done) => {
					const numbered = highlighted.map(
						(line, i) => theme.fg("dim", ` ${String(i + 1).padStart(gutter)} │ `) + line,
					);
					const rows = process.stdout.rows ?? 24;
					const viewH = Math.max(6, Math.min(numbered.length, Math.floor(rows * 0.7)));
					let offset = 0;
					const clamp = () => {
						offset = Math.max(0, Math.min(offset, numbered.length - viewH));
					};
					const scroll = (n: number) => {
						offset += n;
						clamp();
						tui.requestRender();
					};

					return {
						invalidate() {},
						render(width: number) {
							clamp();
							const w = Math.max(10, width - 1);
							const sep = theme.fg("dim", "─".repeat(w));
							const title = theme.fg("accent", ` ${rel}`) + theme.fg("dim", ` · ${numbered.length} lines`);
							const end = Math.min(offset + viewH, numbered.length);
							const hint = theme.fg(
								"dim",
								` ${offset + 1}–${end} of ${numbered.length} · ↑↓/jk scroll · q close`,
							);
							const body = numbered.slice(offset, end).map((l) => truncateToWidth(l, w));
							return [title, sep, ...body, sep, hint];
						},
						handleInput(data: string) {
							if (data === "\x1b" || data === "q") return done(undefined);
							if (data === "\x1b[A" || data === "k") scroll(-1);
							else if (data === "\x1b[B" || data === "j") scroll(1);
							else if (data === "\x1b[5~") scroll(-viewH);
							else if (data === "\x1b[6~") scroll(viewH);
							else if (data === "g") scroll(-numbered.length);
							else if (data === "G") scroll(numbered.length);
						},
						handleMouse(ev) {
							if (ev.type === "wheel" && ev.wheelDelta) {
								scroll(ev.wheelDelta);
								return { handled: true };
							}
							return undefined;
						},
					};
				},
				{ overlay: true, overlayOptions: { width: "85%", maxHeight: "80%", anchor: "center" } },
			);
		},
	});
}
