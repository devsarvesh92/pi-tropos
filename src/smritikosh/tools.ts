/**
 * LLM-callable tools wrapping the smritikosh CLI.
 *
 * Three tools mirror the agent-friendly `explore` workflow:
 *   smritikosh_search  → explore search  (semantic facet search, locations only)
 *   smritikosh_chunks  → explore chunks  (retrieve exact code by path/range)
 *   smritikosh_index   → index           (build/refresh the vector index)
 *
 * Failure philosophy: never hard-fail. If the binary or index is missing,
 * return text the model can act on (ask the user to run /smritikosh-setup,
 * or call smritikosh_index first).
 *
 * The TUI rendering is commandcode.ai-inspired (see ui.ts): an accent ⌘ brand
 * mark, indigo file paths, dim metadata, green counts, amber in-progress.
 */
import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import path from "node:path";
import { dbPathFor, hasIndex, run } from "./client.js";
import { isIndexing, waitForIndexing } from "./indexer.js";
import type { SmritikoshState } from "./state.js";
import {
    parseChunks,
    parseSearchToon,
    toolMark,
    type ChunksDetails,
    type IndexDetails,
    type SearchDetails,
} from "./ui.js";

const NOT_INSTALLED =
    "smritikosh is not installed on this machine, so semantic search is unavailable. " +
    "Ask the user to run /smritikosh-setup to install it (one command, bundled with the pi-smritikosh package), " +
    "and fall back to grep/read for this exploration in the meantime.";

const text = (t: string, details: object = {}) => ({
    content: [{ type: "text" as const, text: t }],
    details,
});

async function ensureIndex(
    bin: string,
    repo: string,
    state: SmritikoshState,
): Promise<{ indexed: boolean; note: string }> {
    // A background index run (session start) may be in flight — wait for it
    // instead of racing DuckDB with a second writer.
    if (isIndexing()) {
        await waitForIndexing();
        if (hasIndex(repo)) return { indexed: true, note: "" };
    }
    if (hasIndex(repo)) return { indexed: true, note: "" };
    if (state.config.autoIndex === false) {
        return {
            indexed: false,
            note:
                `No smritikosh index exists for ${repo} yet. Call smritikosh_index first to build it, ` +
                "then retry this operation.",
        };
    }
    const result = await run(bin, ["index", repo, "--db-path", dbPathFor(repo)], repo);
    if (!result.ok) {
        return {
            indexed: false,
            note: `Auto-indexing ${repo} failed: ${result.stderr || result.error}. Call smritikosh_index for details, or fall back to grep/read.`,
        };
    }
    return { indexed: true, note: `(Built a fresh smritikosh index for ${repo} before running this.)\n\n` };
}

export function registerSmritikoshTools(pi: ExtensionAPI, state: SmritikoshState): void {
    pi.registerTool({
        name: "smritikosh_search",
        label: "Smritikosh Search",
        description:
            "Semantic search over the codebase using the smritikosh vector index. " +
            "Pass 1-8 focused query facets for the same question; returns ranked file locations, " +
            "which you then read with smritikosh_chunks.",
        promptSnippet: "Semantically search the codebase (facet queries in, ranked locations out)",
        promptGuidelines: [
            "Use smritikosh_search for any codebase exploration or 'where is X / how does Y work' question before reaching for grep, find, or read.",
            "Pass 1-8 focused query facets to smritikosh_search, then read the interesting locations with smritikosh_chunks instead of the read tool.",
        ],
        parameters: Type.Object({
            queries: Type.Array(Type.String(), {
                minItems: 1,
                maxItems: 8,
                description: "1-8 focused query facets describing the same question from different angles",
            }),
            repo: Type.Optional(Type.String({ description: "Repo path; defaults to the current working directory" })),
            maxResults: Type.Optional(Type.Number({ description: "Max locations to return (1-24, default 24)" })),
        }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
            if (!state.bin) return text(NOT_INSTALLED, { kind: "search", error: "not installed" });
            const repo = params.repo ?? ctx.cwd;

            const prep = await ensureIndex(state.bin, repo, state);
            if (!prep.indexed) return text(prep.note, { kind: "search", error: "no index" });

            const args = ["explore", "search", ...params.queries, "--db-path", dbPathFor(repo)];
            if (params.maxResults) args.push("--max-results", String(params.maxResults));

            const result = await run(state.bin, args, repo);
            if (!result.ok) {
                const msg = `smritikosh search failed: ${result.stderr || result.error}. Fall back to grep/read if this persists.`;
                return text(msg, { kind: "search", results: [], error: result.stderr || result.error } satisfies SearchDetails);
            }
            const details: SearchDetails = { kind: "search", results: parseSearchToon(result.stdout) };
            return text(prep.note + (result.stdout.trim() || "(no results)"), details);
        },

        renderCall(args, theme, _context) {
            let text = toolMark(theme, "search");
            const first = args.queries?.[0] ?? "";
            text += theme.fg("accent", `"${first.length > 72 ? first.slice(0, 69) + "…" : first}"`);
            if ((args.queries?.length ?? 0) > 1) {
                text += theme.fg("dim", ` +${args.queries.length - 1} facet${args.queries.length > 2 ? "s" : ""}`);
            }
            return new Text(text, 0, 0);
        },

        renderResult(result, { expanded, isPartial }, theme, context) {
            if (isPartial) return new Text(theme.fg("warning", "searching…"), 0, 0);

            const details = result.details as SearchDetails | undefined;
            if (details?.error) {
                return new Text(theme.fg("error", details.error.split("\n").pop() ?? "search failed"), 0, 0);
            }
            const hits = details?.results ?? [];
            if (hits.length === 0) {
                return new Text(theme.fg("dim", "no locations found"), 0, 0);
            }

            let text = theme.fg("success", `${hits.length} location${hits.length === 1 ? "" : "s"}`);
            const shown = expanded ? hits : hits.slice(0, 6);
            for (const h of shown) {
                text += `\n${theme.fg("accent", `${h.path}:${h.startLine}-${h.endLine}`)}`;
                if (h.symbol) text += theme.fg("muted", `  ${h.symbol}`);
                if (expanded && h.facets) text += theme.fg("dim", `  ${h.facets}`);
            }
            if (!expanded && hits.length > shown.length) {
                text += `\n${theme.fg("dim", `… ${hits.length - shown.length} more (${keyHint("app.tools.expand", "to expand")})`)}`;
            }
            void context;
            return new Text(text, 0, 0);
        },
    });

    pi.registerTool({
        name: "smritikosh_chunks",
        label: "Smritikosh Chunks",
        description:
            "Retrieve indexed code from an exact file path in the smritikosh index. " +
            "Without a line range, lists the file's definitions as an outline; with startLine/endLine, " +
            "prints the numbered source of that range.",
        promptSnippet: "Read exact code ranges from files found via smritikosh_search",
        parameters: Type.Object({
            path: Type.String({ description: "File path, as returned by smritikosh_search" }),
            repo: Type.Optional(Type.String({ description: "Repo path; defaults to the current working directory" })),
            startLine: Type.Optional(Type.Number({ description: "First line to read (1-based)" })),
            endLine: Type.Optional(Type.Number({ description: "Last line to read" })),
            full: Type.Optional(Type.Boolean({ description: "Print every stored chunk in the file" })),
        }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
            if (!state.bin) return text(NOT_INSTALLED, { kind: "chunks", error: "not installed" });
            const repo = params.repo ?? ctx.cwd;
            if (!hasIndex(repo)) {
                return text(`No smritikosh index exists for ${repo}. Call smritikosh_index first.`, {
                    kind: "chunks",
                    error: "no index",
                });
            }

            const args = ["explore", "chunks", params.path, "--db-path", dbPathFor(repo)];
            if (params.startLine && params.endLine) {
                args.push("--range", params.path, String(params.startLine), String(params.endLine));
            } else if (params.full) {
                args.push("--full");
            }

            const result = await run(state.bin, args, repo);
            if (!result.ok) {
                const msg = `smritikosh chunks failed: ${result.stderr || result.error}`;
                return text(msg, { kind: "chunks", info: null, error: result.stderr || result.error } satisfies ChunksDetails);
            }
            const details: ChunksDetails = { kind: "chunks", info: parseChunks(result.stdout) };
            return text(result.stdout.trim() || "(no output)", details);
        },

        renderCall(args, theme, _context) {
            let text = toolMark(theme, "chunks");
            text += theme.fg("accent", args.path);
            if (args.startLine && args.endLine) {
                text += theme.fg("dim", `:${args.startLine}-${args.endLine}`);
            } else if (args.full) {
                text += theme.fg("dim", " (full)");
            } else {
                text += theme.fg("dim", " (outline)");
            }
            return new Text(text, 0, 0);
        },

        renderResult(result, { expanded, isPartial }, theme, _context) {
            if (isPartial) return new Text(theme.fg("warning", "reading…"), 0, 0);

            const details = result.details as ChunksDetails | undefined;
            if (details?.error) {
                return new Text(theme.fg("error", details.error.split("\n").pop() ?? "chunks failed"), 0, 0);
            }
            const info = details?.info;
            if (!info) {
                return new Text(theme.fg("dim", "no output"), 0, 0);
            }

            const noun = info.mode === "outline" ? "entries" : "lines";
            let text =
                theme.fg("success", `${info.count} ${noun}`) + theme.fg("dim", ` · ${info.header}`);

            if (expanded) {
                if (info.mode === "range" && info.numbered) {
                    const width = String(info.numbered[info.numbered.length - 1].n).length;
                    const cap = 60;
                    for (const line of info.numbered.slice(0, cap)) {
                        text += `\n${theme.fg("dim", `${String(line.n).padStart(width)} │ `)}${line.text}`;
                    }
                    if (info.numbered.length > cap) {
                        text += `\n${theme.fg("dim", `… ${info.numbered.length - cap} more lines`)}`;
                    }
                } else {
                    const content = result.content[0];
                    const body = content?.type === "text" ? content.text.split("\n") : [];
                    for (const line of body.slice(0, 40)) {
                        text += `\n${theme.fg("dim", line)}`;
                    }
                    if (body.length > 40) text += `\n${theme.fg("dim", `… ${body.length - 40} more lines`)}`;
                }
            }
            return new Text(text, 0, 0);
        },
    });

    pi.registerTool({
        name: "smritikosh_index",
        label: "Smritikosh Index",
        description:
            "Build or incrementally update the smritikosh vector index for a repository. " +
            "Run this when search results look stale or no index exists yet.",
        promptSnippet: "Build or refresh the semantic search index for a repo",
        parameters: Type.Object({
            repo: Type.Optional(Type.String({ description: "Repo path; defaults to the current working directory" })),
            full: Type.Optional(Type.Boolean({ description: "Force a full rebuild instead of an incremental update" })),
        }),
        async execute(_id, params, _signal, onUpdate, ctx) {
            if (!state.bin) return text(NOT_INSTALLED, { kind: "index", error: "not installed" });
            const repo = params.repo ?? ctx.cwd;

            const args = ["index", repo, "--db-path", dbPathFor(repo)];
            if (params.full) args.push("--full");

            onUpdate?.({ content: [{ type: "text", text: `Indexing ${path.basename(repo)}…` }], details: {} });
            const result = await run(state.bin, args, repo);
            if (!result.ok) {
                const msg = `smritikosh index failed: ${result.stderr || result.error}`;
                return text(msg, { kind: "index", repo, error: result.stderr || result.error } satisfies IndexDetails);
            }
            const summary = result.stdout.trim().split("\n").pop() ?? "";
            const details: IndexDetails = { kind: "index", repo, summary };
            return text(`Index updated for ${repo}.\n${result.stdout.trim()}`.trim(), details);
        },

        renderCall(args, theme, _context) {
            let text = toolMark(theme, "index");
            text += theme.fg("accent", path.basename(args.repo ?? process.cwd()));
            if (args.full) text += theme.fg("dim", " (full rebuild)");
            return new Text(text, 0, 0);
        },

        renderResult(result, { isPartial }, theme, _context) {
            if (isPartial) return new Text(theme.fg("warning", "indexing…"), 0, 0);

            const details = result.details as IndexDetails | undefined;
            if (details?.error) {
                return new Text(theme.fg("error", details.error.split("\n").pop() ?? "index failed"), 0, 0);
            }
            let text = theme.fg("success", "✓ index updated");
            if (details?.summary) text += theme.fg("dim", ` · ${details.summary}`);
            return new Text(text, 0, 0);
        },
    });
}
