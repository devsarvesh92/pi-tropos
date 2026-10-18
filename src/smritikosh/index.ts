/**
 * Smritikosh — semantic codebase exploration, powered by the smritikosh CLI.
 *
 * Merged in from the standalone pi-smritikosh package so pi-tropos is the
 * single source. The CLI itself is installed from PyPI via `uv tool install`
 * rather than vendored, so it updates independently of this package.
 *
 * Config: ~/.pi/agent/pi-smritikosh.json  ({ "path": "...", "autoIndex": true })
 * Commands: /smritikosh-setup, /smritikosh-upgrade, /smritikosh-status
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import type { SmritikoshState } from "./state.js";
import { registerSmritikoshCommands, resolveOnSessionStart } from "./commands.js";
import { registerSmritikoshTools } from "./tools.js";
import { indexOnSessionStart, stopIndexer } from "./indexer.js";
import { registerEnforcement } from "./enforce.js";

export default function (pi: ExtensionAPI) {
    const state: SmritikoshState = {
        config: loadConfig(),
        bin: null,
        warnedMissing: false,
    };

    pi.on("session_start", (_event, ctx) => {
        state.config = loadConfig();
        resolveOnSessionStart(state, ctx);
        // IntelliJ-style: kick off background indexing immediately, never block startup.
        indexOnSessionStart(state, ctx);
    });

    pi.on("session_shutdown", () => {
        stopIndexer();
    });

    // Tools and commands are registered unconditionally at load time; the
    // tools themselves gate on state.bin so they degrade gracefully when the
    // CLI is not installed yet.
    registerSmritikoshTools(pi, state);
    registerSmritikoshCommands(pi, state);
    registerEnforcement(pi, state);
}
