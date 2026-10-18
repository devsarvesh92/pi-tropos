/**
 * commandcode.ai-inspired styling for the pi-smritikosh terminal UI.
 *
 * The web aesthetic (dark zinc, indigo accent, Geist Mono, hairline borders,
 * pastel status colors) maps onto pi's theme tokens:
 *   accent      → commandcode indigo (#556af3): brand glyph, paths, key data
 *   success     → commandcode green  (#00c758): ready states, result counts
 *   warning     → commandcode amber  (#f99c00): in-progress states
 *   dim / muted → zinc grays: metadata, line numbers, facet tags
 *
 * The ⌘ glyph is commandcode's brand mark. During background work it is
 * replaced by a braille spinner, exactly like the site's animated loaders.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";

export const GLYPH = "⌘";
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Brand mark: accent "⌘" + accent "smritikosh". */
export function brand(theme: Theme): string {
    return `${theme.fg("accent", theme.bold(GLYPH))} ${theme.fg("accent", "smritikosh")}`;
}

/** Tool header: accent "⌘" + bold verb + trailing space. */
export function toolMark(theme: Theme, verb: string): string {
    return `${theme.fg("accent", theme.bold(GLYPH))} ${theme.fg("toolTitle", theme.bold(verb))} `;
}

// ---------------------------------------------------------------------------
// Footer status lines
// ---------------------------------------------------------------------------

/** Idle/ready footer status: `⌘ smritikosh ✓` (optionally `✓ watching`). */
export function statusReady(theme: Theme, watching = false): string {
    const ok = theme.fg("success", "✓");
    return `${brand(theme)} ${ok}${watching ? theme.fg("dim", " watching") : ""}`;
}

/** Busy footer status without real progress (stage-only): spinner + label. */
export function statusBusy(theme: Theme, frame: number, label: string): string {
    const spinner = theme.fg("accent", SPINNER[frame % SPINNER.length]);
    return `${spinner} ${theme.fg("accent", "smritikosh")} ${theme.fg("dim", `· ${label}`)}`;
}

const BAR_WIDTH = 10;
const BAR_FILL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Sub-cell-accurate bar: accent fill on a dim track — `██████▊░░░`. */
export function statusProgress(
    theme: Theme,
    frame: number,
    progress: { done: number; total: number },
    etaSeconds?: number,
): string {
    const ratio = Math.max(0, Math.min(1, progress.total > 0 ? progress.done / progress.total : 0));
    const exact = ratio * BAR_WIDTH;
    const fullCells = Math.floor(exact);
    const frac = exact - fullCells;

    let fill = "█".repeat(fullCells);
    let track: string;
    if (fullCells < BAR_WIDTH) {
        const fracIdx = Math.round(frac * 8);
        if (fracIdx >= 8) {
            fill += "█";
            track = "░".repeat(BAR_WIDTH - fullCells - 1);
        } else {
            fill += fracIdx > 0 ? BAR_FILL[fracIdx] : "";
            track = "░".repeat(BAR_WIDTH - fullCells - (fracIdx > 0 ? 1 : 0));
        }
    } else {
        track = "";
    }

    const spinner = theme.fg("accent", SPINNER[frame % SPINNER.length]);
    const pct = Math.floor(ratio * 100);
    let text = `${spinner} ${theme.fg("accent", "smritikosh")} `;
    text += theme.fg("accent", fill) + theme.fg("dim", track);
    text += ` ${pct}%`;
    text += theme.fg("dim", ` · ${progress.done}/${progress.total}`);
    if (etaSeconds !== undefined) text += theme.fg("dim", ` · ~${etaSeconds}s`);
    return text;
}

// ---------------------------------------------------------------------------
// CLI output parsing (drives the custom tool renderers via `details`)
// ---------------------------------------------------------------------------

export interface SearchHit {
    path: string;
    startLine: number;
    endLine: number;
    symbol: string;
    facets: string;
}

/** Split one TOON table row, respecting quoted fields. */
function splitToonRow(row: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (inQuotes) {
            if (c === '"') {
                if (row[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            out.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

/**
 * Parse the `search_results` TOON table emitted by `smritikosh explore search`:
 *
 *   search_results[2]{path,start_line,end_line,symbol,facets}:
 *     src/auth/policy.py,176,193,authorize,Q1|Q3
 */
export function parseSearchToon(stdout: string): SearchHit[] {
    const lines = stdout.split("\n");
    const headerIdx = lines.findIndex((l) => l.trimStart().startsWith("search_results["));
    if (headerIdx === -1) return [];

    const hits: SearchHit[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw.trim()) continue;
        if (!/^\s/.test(raw)) break; // TOON rows are indented; a flush-left line ends the table
        const fields = splitToonRow(raw.trim());
        if (fields.length < 5) continue;
        const [p, s, e, symbol, facets] = fields;
        const startLine = Number(s);
        const endLine = Number(e);
        if (!p || Number.isNaN(startLine) || Number.isNaN(endLine)) continue;
        hits.push({ path: p, startLine, endLine, symbol: symbol ?? "", facets: facets ?? "" });
    }
    return hits;
}

export interface ChunksInfo {
    mode: "range" | "outline" | "full";
    /** First output line, e.g. `src/a.py:10-20` or `src/a.py  (12 entries)`. */
    header: string;
    /** Lines (range), entries (outline), or body lines (full). */
    count: number;
    /** Numbered source lines, range mode only. */
    numbered?: { n: number; text: string }[];
}

/**
 * Parse `smritikosh explore chunks` output. Three shapes:
 *   range:   `path:START-END` header, then `NN  text` lines
 *   outline: `path  (N entries)` header, then `span  kind  name` rows
 *   full:    `path:START-END  [kind]` header, then indented chunk text
 */
export function parseChunks(stdout: string): ChunksInfo | null {
    const lines = stdout.split("\n");
    const idx = lines.findIndex((l) => l.trim().length > 0);
    if (idx === -1) return null;
    const header = lines[idx].trim();

    const outline = header.match(/^(.+?)\s{2,}\((\d+) entries\)$/);
    if (outline) {
        return { mode: "outline", header, count: parseInt(outline[2], 10) };
    }

    if (/^.+:\d+-\d+/.test(header)) {
        const numbered: { n: number; text: string }[] = [];
        for (const l of lines.slice(idx + 1)) {
            const m = l.match(/^\s*(\d+)\s{2}(.*)$/);
            if (m) numbered.push({ n: Number(m[1]), text: m[2] });
        }
        if (numbered.length > 0) {
            return { mode: "range", header, count: numbered.length, numbered };
        }
        const body = lines.slice(idx + 1).filter((l) => l.trim().length > 0).length;
        return { mode: "full", header, count: body };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Tool `details` payloads (consumed by the custom renderers)
// ---------------------------------------------------------------------------

export interface SearchDetails {
    kind: "search";
    results: SearchHit[];
    error?: string;
}

export interface ChunksDetails {
    kind: "chunks";
    info: ChunksInfo | null;
    error?: string;
}

export interface IndexDetails {
    kind: "index";
    repo: string;
    summary?: string;
    error?: string;
}
