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
    /** Check PyPI for a newer CLI on session start. Default true. */
    upgradeCheck?: boolean;
    /**
     * Install a newer CLI automatically instead of just mentioning it.
     * Default false: a release can change the index schema, and a silent
     * upgrade would then force a reindex of every repo mid-work.
     */
    autoUpgrade?: boolean;
    /** Hours between upgrade checks. Default 24. */
    upgradeCheckHours?: number;
}

/** Throttle state, kept out of the user-edited config file. */
export function getCachePath(): string {
    return path.join(os.homedir(), ".pi", "agent", "pi-smritikosh-cache.json");
}

export function readLastCheck(): number {
    try {
        return JSON.parse(fs.readFileSync(getCachePath(), "utf8")).lastUpgradeCheck ?? 0;
    } catch {
        return 0;
    }
}

export function writeLastCheck(when: number): void {
    try {
        fs.mkdirSync(path.dirname(getCachePath()), { recursive: true });
        fs.writeFileSync(getCachePath(), JSON.stringify({ lastUpgradeCheck: when }, null, 2));
    } catch {
        // A missing cache only means we check again next session.
    }
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
