/**
 * Peek — transient code viewer overlay. Leaves no trace in the chat.
 *
 *   /peek src/footer.ts
 *
 * Opens a centered overlay with the file syntax-highlighted (kaapi
 * theme colors) and line-numbered. Scroll with ↑/↓, PgUp/PgDn, g/G;
 * Esc or q closes. Nothing is appended to the transcript.
 */

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { ScrollView, truncateToWidth } from "@earendil-works/pi-tui";

const MAX_BYTES = 200_000;

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
			const path = isAbsolute(target) ? target : join(ctx.cwd, target);

			let content: string;
			try {
				const stat = statSync(path);
				if (!stat.isFile()) throw new Error("not a file");
				if (stat.size > MAX_BYTES) throw new Error("file too large");
				content = readFileSync(path, "utf-8");
			} catch (err) {
				ctx.ui.notify(`Cannot peek: ${err instanceof Error ? err.message : err}`, "error");
				return;
			}

			const lang = getLanguageFromPath(path);
			const highlighted = highlightCode(content, lang);

			await ctx.ui.custom(
				(tui, theme, _kb, done) => {
					const gutter = String(highlighted.length).length;
					const numbered = highlighted.map(
						(line, i) => theme.fg("dim", `${String(i + 1).padStart(gutter)} │ `) + line,
					);
					const inner = {
						invalidate() {},
						render: (width: number) => numbered.map((l) => truncateToWidth(l, width - 2)),
					};
					const scroll = new ScrollView(inner, { follow: "none", overscroll: "contain" });

					return {
						invalidate() {},
						render: (width: number) => scroll.render(width),
						handleInput(data: string) {
							if (data === "\x1b" || data === "q") return done(undefined);
							if (data === "\x1b[A" || data === "k") scroll.scrollBy(-1);
							else if (data === "\x1b[B" || data === "j") scroll.scrollBy(1);
							else if (data === "\x1b[5~") scroll.scrollBy(-10);
							else if (data === "\x1b[6~") scroll.scrollBy(10);
							else if (data === "g") scroll.scrollToStart();
							else if (data === "G") scroll.scrollToEnd();
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: { width: "85%", maxHeight: "80%", anchor: "center" },
				},
			);
		},
	});
}
