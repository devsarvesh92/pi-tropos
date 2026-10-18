import type { PiSmritikoshConfig } from "./config.js";

export interface SmritikoshState {
    config: PiSmritikoshConfig;
    /** Resolved absolute path to the smritikosh binary, or null if not found. */
    bin: string | null;
    /** Whether we already told the user the binary is missing this session. */
    warnedMissing: boolean;
}
