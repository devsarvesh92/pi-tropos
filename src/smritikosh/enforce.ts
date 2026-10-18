/**
 * Search-tool enforcement.
 *
 * Guidelines alone don't stop models from reaching for grep/rg/find out of
 * habit. This intercepts bash tool calls and blocks repo-searching commands,
 * redirecting the model to smritikosh_search.
 *
 * What gets blocked: a search tool appearing as the START of a command
 * segment (after &&, ;, ||, or | boundaries):
 *   grep -rn "foo" app/          → blocked
 *   find . -name "*.py"          → blocked
 *
 * What stays allowed (deliberately):
 *   npm test | grep FAIL         → grep is filtering output, not searching the repo
 *   git log --oneline | head     → no search tool as a segment starter
 *   ls, cat, head, tail, wc      → cheap orientation, not worth the friction
 *
 * Escape hatch for genuine literal-string searches (exact error message,
 * identifier spelling): the block reason tells the model it may retry the
 * identical command once; the retry is allowed through.
 */
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmritikoshState } from "./state.js";

// Split on command separators but NOT pipes: a search tool after `|` is
// filtering another command's output (npm test | grep FAIL), which is
// legitimate use, not repo exploration.
const SEGMENT_SPLIT = /\|\||&&|;/;
const SEARCH_TOOL = /^(sudo\s+)?(grep|rg|ag|ack|find|fd|tree)\b/;

/** Returns the blocked tool name if the command searches the repo, else null. */
export function findBlockedSearchTool(command: string): string | null {
    for (const segment of command.split(SEGMENT_SPLIT)) {
        const match = segment.trim().match(SEARCH_TOOL);
        if (match) return match[2];
    }
    return null;
}

const BLOCK_REASON = (tool: string) =>
    `Blocked: '${tool}' searches the codebase, which smritikosh does better. ` +
    "Use smritikosh_search with 1-8 focused query facets, then read results with smritikosh_chunks. " +
    `Exception: if you truly need an exact literal-string match (e.g. a specific error message or ` +
    `identifier spelling that semantic search would miss), retry the identical '${tool}' command once ` +
    "and it will be allowed.";

export function registerEnforcement(pi: ExtensionAPI, state: SmritikoshState): void {
    /** Commands the model has been told it may retry once. */
    const allowedRetries = new Set<string>();

    pi.on("session_start", () => allowedRetries.clear());

    pi.on("tool_call", async (event) => {
        if (state.config.enforceSearchTools === false) return;
        if (!state.bin) return; // CLI unavailable: search tools are the fallback, don't block them
        if (!isToolCallEventType("bash", event)) return;

        const command = event.input.command ?? "";
        const blocked = findBlockedSearchTool(command);
        if (!blocked) return;

        if (allowedRetries.has(command)) {
            allowedRetries.delete(command);
            return; // one sanctioned retry for literal searches
        }

        allowedRetries.add(command);
        return { block: true, reason: BLOCK_REASON(blocked) };
    });
}
