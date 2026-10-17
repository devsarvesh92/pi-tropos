/**
 * Barista — kaapi-flavored working mascot.
 *
 * Replaces the default spinner with a steaming coffee cup; every other
 * brew cycle the cup turns into a boba. Hidden thinking blocks are
 * labeled "Steeping…". Purely cosmetic, zero logic.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FRAMES = [
	"☕ ∘   ",
	"☕  ∘  ",
	"☕   ∘ ",
	"☕    ∘",
	"☕     ",
	"☕ ∘   ",
	"☕  ∘  ",
	"☕   ∘ ",
	"☕    ∘",
	"☕     ",
	"🧋 ∘   ",
	"🧋  ∘  ",
	"🧋   ∘ ",
	"🧋    ∘",
	"🧋     ",
];

export default function barista(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWorkingIndicator({ frames: FRAMES, intervalMs: 160 });
		ctx.ui.setHiddenThinkingLabel("Steeping…");
	});
}
