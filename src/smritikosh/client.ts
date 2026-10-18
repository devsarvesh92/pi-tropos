/**
 * Binary resolution, self-bootstrap, and CLI runner for smritikosh.
 *
 * The CLI is installed from PyPI with `uv tool install`, never vendored.
 * Vendoring the Python source inside the npm package froze it at whatever
 * version was current at publish time, so a CLI fix needed a package release
 * to reach anyone. From PyPI it updates on its own schedule:
 *
 *     /smritikosh-upgrade   →  uv tool upgrade smritikosh
 *
 * Resolution order:
 *   1. config.path (~/.pi/agent/pi-smritikosh.json)
 *   2. $SMRITIKOSH_BIN
 *   3. PATH
 *   4. ~/.local/bin/smritikosh  (uv tool / pipx install target)
 *
 * Everything is resolved to an absolute path so a broken PATH in
 * GUI-launched terminals never breaks the tools.
 */
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiSmritikoshConfig } from "./config.js";

/** Where `uv tool install` puts executables. */
const UV_TOOL_BIN = path.join(os.homedir(), ".local", "bin", "smritikosh");

const isExecutable = (p: string): boolean => {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
};

function which(cmd: string): string | null {
    try {
        const out = execFileSync("which", [cmd], { encoding: "utf8" }).trim();
        return out && isExecutable(out) ? out : null;
    } catch {
        return null;
    }
}

export function resolveBinary(config: PiSmritikoshConfig): string | null {
    const candidates = [config.path, process.env.SMRITIKOSH_BIN, which("smritikosh"), UV_TOOL_BIN].filter(
        (c): c is string => typeof c === "string" && c.length > 0,
    );

    for (const c of candidates) {
        if (isExecutable(c)) return c;
    }
    return null;
}

export function findUv(): string | null {
    return (
        which("uv") ??
        [path.join(os.homedir(), ".local", "bin", "uv"), path.join(os.homedir(), ".cargo", "bin", "uv")].find(
            isExecutable,
        ) ??
        null
    );
}

export interface RunResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    error?: string;
}

export function run(bin: string, args: string[], cwd: string): Promise<RunResult> {
    return new Promise((resolve) => {
        execFile(bin, args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
            if (err) {
                resolve({ ok: false, stdout: stdout ?? "", stderr: stderr ?? "", error: err.message });
            } else {
                resolve({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "" });
            }
        });
    });
}

async function runStep(bin: string, args: string[], cwd: string): Promise<RunResult> {
    return run(bin, args, cwd);
}

export interface BootstrapResult {
    ok: boolean;
    bin?: string;
    message: string;
}

const NO_UV =
    "uv is not installed. Install it with `brew install uv` or " +
    "`curl -LsSf https://astral.sh/uv/install.sh | sh`, then run the command again.";

/**
 * Install the smritikosh CLI from PyPI. uv brings its own Python, so no
 * system interpreter is needed and nothing is written inside this package.
 */
export async function bootstrap(): Promise<BootstrapResult> {
    const uv = findUv();
    if (!uv) return { ok: false, message: NO_UV };

    const install = await runStep(uv, ["tool", "install", "smritikosh"], os.homedir());
    if (!install.ok) {
        return { ok: false, message: `uv tool install smritikosh failed: ${install.stderr || install.error}` };
    }

    const bin = resolveBinary({});
    if (!bin) {
        return {
            ok: false,
            message:
                "uv reported success but the smritikosh executable was not found. Ensure ~/.local/bin is on " +
                'PATH, or set "path" in ~/.pi/agent/pi-smritikosh.json.',
        };
    }
    return { ok: true, bin, message: `smritikosh installed at ${bin}` };
}

/** `smritikosh, version 0.4.0` → `0.4.0`. */
export async function installedVersion(bin: string): Promise<string | null> {
    const result = await run(bin, ["--version"], os.homedir());
    return result.ok ? (result.stdout.match(/(\d+\.\d+\.\d+\S*)/)?.[1] ?? null) : null;
}

/** Newest release on PyPI, or null when offline. Cheap: ~0.3s, no uv. */
export async function latestVersion(timeoutMs = 4000): Promise<string | null> {
    try {
        const response = await fetch("https://pypi.org/pypi/smritikosh/json", {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { info?: { version?: string } };
        return body.info?.version ?? null;
    } catch {
        return null; // offline, DNS failure, timeout — never surfaced
    }
}

/** Semver-ish compare for x.y.z tags: numeric parts first, then final-beats-prerelease. */
export function isNewer(candidate: string, current: string): boolean {
	const parse = (v: string) => {
		const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
		if (!m) return null;
		return { n: [+m[1], +m[2], +m[3]], pre: /[a-zA-Z]/.test(m[4]) };
	};
	const a = parse(candidate);
	const b = parse(current);
	if (!a || !b) return false; // unparseable — never upgrade on garbage
	for (let i = 0; i < 3; i++) {
		if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
	}
	// Same numeric core: a final release is newer than a prerelease.
	if (a.pre !== b.pre) return !a.pre;
	return false;
}

/** Pull the newest release from PyPI. */
export async function upgrade(): Promise<BootstrapResult> {
    const uv = findUv();
    if (!uv) return { ok: false, message: NO_UV };

    const result = await runStep(uv, ["tool", "upgrade", "smritikosh"], os.homedir());
    if (!result.ok) {
        return { ok: false, message: `uv tool upgrade failed: ${result.stderr || result.error}` };
    }
    const output = `${result.stdout}${result.stderr}`.trim();
    return {
        ok: true,
        bin: resolveBinary({}) ?? undefined,
        message: /nothing to upgrade|already up.to.date/i.test(output)
            ? "smritikosh is already on the latest release."
            : output.split("\n").slice(-3).join("\n") || "smritikosh upgraded.",
    };
}

/** The DuckDB index for a repo lives next to it, matching the CLI default. */
export function dbPathFor(repo: string): string {
    return path.join(repo, "smritikosh.duckdb");
}

export function hasIndex(repo: string): boolean {
    return fs.existsSync(dbPathFor(repo));
}
