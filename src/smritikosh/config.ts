import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PiSmritikoshConfig {
    /** Absolute path to a smritikosh binary. Overrides all discovery. */
    path?: string;
    /** Auto-run `smritikosh index` when a repo has no index yet. Default true. */
    autoIndex?: boolean;
    /** Index/refresh the repo in the background on session start. Default true. */
    indexOnStart?: boolean;
    /** Keep `smritikosh index -L` alive for the session (live reindex on save). Default false. */
    watch?: boolean;
    /** Block bash grep/rg/find-style repo searches, redirecting to smritikosh_search. Default true. */
    enforceSearchTools?: boolean;
}

export function getConfigPath(): string {
    return path.join(os.homedir(), ".pi", "agent", "pi-smritikosh.json");
}

export function loadConfig(): PiSmritikoshConfig {
    try {
        return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
    } catch {
        return {};
    }
}
