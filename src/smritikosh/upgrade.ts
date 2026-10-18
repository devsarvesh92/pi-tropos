/**
 * Keep the CLI current without the user thinking about it.
 *
 * On session start we compare the installed CLI against PyPI and either
 * mention a newer release or install it, depending on `autoUpgrade`.
 *
 * Three rules keep this from being annoying:
 *   - never blocks startup: the whole thing is fire-and-forget
 *   - throttled to once per `upgradeCheckHours` (default 24) via a cache file
 *   - silent when offline: a failed check is indistinguishable from no update
 *
 * `autoUpgrade` defaults to false on purpose. A CLI release can change the
 * DuckDB index schema, and upgrading underneath a running session would then
 * force a reindex of every repo at the worst moment. Telling you, and letting
 * you run /smritikosh-upgrade when convenient, keeps that decision yours.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installedVersion, isNewer, latestVersion, upgrade } from "./client.js";
import { readLastCheck, writeLastCheck } from "./config.js";
import type { SmritikoshState } from "./state.js";

const HOUR_MS = 60 * 60 * 1000;

async function check(state: SmritikoshState, ctx: ExtensionContext): Promise<void> {
	if (!state.bin) return;

	const current = await installedVersion(state.bin);
	if (!current) return;

	const latest = await latestVersion();
	if (!latest || !isNewer(latest, current)) return;

	if (!state.config.autoUpgrade) {
		if (ctx.hasUI) {
			ctx.ui.notify(`smritikosh ${latest} is available (you have ${current}) — /smritikosh-upgrade`, "info");
		}
		return;
	}

	const result = await upgrade();
	if (result.ok && result.bin) state.bin = result.bin;
	if (ctx.hasUI) {
		ctx.ui.notify(
			result.ok
				? `smritikosh upgraded ${current} → ${latest}. Reindex if search behaves oddly: smritikosh_index.`
				: `smritikosh auto-upgrade failed: ${result.message}`,
			result.ok ? "info" : "warning",
		);
	}
}

/** Fire-and-forget: callers must not await this. */
export function upgradeCheckOnSessionStart(state: SmritikoshState, ctx: ExtensionContext): void {
	if (state.config.upgradeCheck === false) return;
	if (!state.bin) return; // nothing installed yet — /smritikosh-setup handles that case

	const intervalMs = Math.max(0, state.config.upgradeCheckHours ?? 24) * HOUR_MS;
	if (Date.now() - readLastCheck() < intervalMs) return;

	writeLastCheck(Date.now()); // before awaiting, so parallel sessions don't both check
	void check(state, ctx).catch(() => {
		// Never surface: an upgrade check is not worth an error toast.
	});
}
