/**
 * IntelliJ-style background indexing.
 *
 * On session start:
 *   - no index        → build it in the background (first-open experience)
 *   - existing index  → incremental refresh in the background (picks up your
 *                       edits since the last session)
 *
 * Optional watch mode (config "watch": true) keeps `smritikosh index -L`
 * alive for the whole session so the index tracks file saves in real time.
 *
 * Searches started while an index run is in flight wait for it instead of
 * racing DuckDB (single-writer). Tools never start a second run.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dbPathFor, hasIndex } from "./client.js";
import type { SmritikoshState } from "./state.js";
import { statusBusy, statusProgress, statusReady } from "./ui.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** In-flight background index run for the current session, if any. */
let indexing: Promise<void> | null = null;
/** Live watch process (config "watch": true), killed on session shutdown. */
let watcher: ChildProcess | null = null;

/** Wait for any in-flight background index run. Used by the tools. */
export async function waitForIndexing(): Promise<void> {
    await indexing;
}

export function isIndexing(): boolean {
    return indexing !== null;
}

function setStatus(ctx: ExtensionContext, value?: string): void {
    if (ctx.hasUI) ctx.ui.setStatus("smritikosh", value);
}

interface IndexRunResult {
    ok: boolean;
    output: string;
}

interface Progress {
    done: number;
    total: number;
}

/**
 * Find the Python interpreter that owns a smritikosh install by reading the
 * entry point's shebang (works for venvs, pipx, and uv tool installs).
 */
function pythonFor(bin: string): string | null {
    try {
        const fd = fs.openSync(bin, "r");
        const buf = Buffer.alloc(256);
        fs.readSync(fd, buf, 0, 256, 0);
        fs.closeSync(fd);
        const line = buf.toString("utf8").split("\n")[0];
        const match = line.match(/^#!(\S+)/);
        if (match && fs.existsSync(match[1])) return match[1];
    } catch {
        // fall through
    }
    return null;
}

/**
 * Run the indexing pipeline through our progress wrapper, which reports real
 * per-file counts. The wrapper imports smritikosh internals, so a future CLI
 * release can make it unusable; `useWrapper` then falls back to the plain CLI
 * with stage-only progress rather than failing.
 */
function runIndexWithProgress(
    bin: string,
    repo: string,
    label: string,
    ctx: ExtensionContext,
): Promise<IndexRunResult> {
    const wrapper = path.join(MODULE_DIR, "python", "smk_progress.py");
    const python = pythonFor(bin);

    const useWrapper = python !== null && fs.existsSync(wrapper);
    const cmd = useWrapper ? python : bin;
    const args = useWrapper
        ? [wrapper, repo, dbPathFor(repo)]
        : ["index", repo, "--db-path", dbPathFor(repo)];

    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: repo });

        let output = "";
        let error: string | null = null;
        let progress: Progress | null = null;
        let sawWrapperProtocol = false;
        const started = Date.now();
        let frame = 0;

        const render = () => {
            if (!ctx.hasUI) return;
            const theme = ctx.ui.theme;
            const currentFrame = frame;
            frame++;
            const elapsed = Math.floor((Date.now() - started) / 1000);

            if (progress && progress.total > 0) {
                const ratio = progress.done / progress.total;
                let eta: number | undefined;
                if (progress.done >= 5 && ratio < 1) {
                    const rate = progress.done / Math.max(1, (Date.now() - started) / 1000);
                    eta = Math.round((progress.total - progress.done) / Math.max(rate, 0.01));
                }
                setStatus(ctx, statusProgress(theme, currentFrame, progress, eta));
            } else {
                setStatus(ctx, statusBusy(theme, currentFrame, `${label} · ${elapsed}s`));
            }
        };
        render();
        const timer = ctx.hasUI ? setInterval(render, 120) : null;

        let tail = "";
        const onData = (chunk: Buffer) => {
            const text = chunk.toString();
            output += text;
            tail = (tail + text).split("\n").slice(-20).join("\n");
            for (const line of text.split("\n")) {
                const total = line.match(/^SMK total (\d+)/);
                const prog = line.match(/^SMK progress (\d+) (\d+)/);
                const err = line.match(/^SMK error (.*)/);
                if (total) {
                    sawWrapperProtocol = true;
                    progress = { done: 0, total: parseInt(total[1], 10) };
                } else if (prog) {
                    progress = { done: parseInt(prog[1], 10), total: parseInt(prog[2], 10) };
                } else if (err) {
                    error = err[1];
                }
            }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (err) => {
            if (timer) clearInterval(timer);
            resolve({ ok: false, output: err.message });
        });
        child.on("close", (code) => {
            if (timer) clearInterval(timer);
            resolve({
                ok: code === 0 && !error,
                output: error ?? tail,
            });
        });
    });
}

function startBackgroundIndex(state: SmritikoshState, ctx: ExtensionContext): void {
    const bin = state.bin;
    if (!bin || indexing) return;

    const repo = ctx.cwd;
    const fresh = !hasIndex(repo);

    indexing = (async () => {
        try {
            const result = await runIndexWithProgress(
                bin,
                repo,
                fresh ? "building index" : "refreshing index",
                ctx,
            );
            if (ctx.hasUI) {
                if (result.ok) {
                    ctx.ui.notify(fresh ? "smritikosh index ready ✓" : "smritikosh index refreshed ✓", "info");
                } else {
                    ctx.ui.notify(`smritikosh background indexing failed: ${result.output.trim().split("\n").pop()}`, "warning");
                }
            }
        } finally {
            if (ctx.hasUI) setStatus(ctx, statusReady(ctx.ui.theme));
            indexing = null;
        }
    })();
}

function startWatcher(state: SmritikoshState, ctx: ExtensionContext): void {
    const bin = state.bin;
    if (!bin || watcher) return;
    const repo = ctx.cwd;

    watcher = spawn(bin, ["index", repo, "--db-path", dbPathFor(repo), "--watch"], {
        cwd: repo,
        stdio: "ignore",
    });
    watcher.on("exit", () => {
        watcher = null;
    });
    if (ctx.hasUI) setStatus(ctx, statusReady(ctx.ui.theme, true));
}

export function stopIndexer(): void {
    watcher?.kill();
    watcher = null;
}

/**
 * Called from session_start. Decides between watch mode and one-shot
 * background indexing based on config. Never blocks session startup.
 */
export function indexOnSessionStart(state: SmritikoshState, ctx: ExtensionContext): void {
    if (!state.bin) return;
    if (state.config.indexOnStart === false) return;

    // In watch mode the watcher itself performs the initial build/refresh.
    if (state.config.watch) {
        startWatcher(state, ctx);
    } else {
        startBackgroundIndex(state, ctx);
    }
}
