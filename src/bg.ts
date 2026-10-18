/**
 * Bg — background agents. /bg <task> runs a detached `pi -p` subprocess
 * while you keep working in the foreground; notify on completion.
 *
 *   /bg add tests for auth      shared tree — sees your uncommitted changes
 *   /bg -w spike redis cache    worktree isolation on branch bg/<name>
 *   /bg -n my-name <task>       explicit name (default: slug from task)
 *   /bg                         live list — status, elapsed, last log line
 *   /bg show <name|id>          log viewer overlay, tail-f follow mode
 *   /bg kill <name|id>          SIGTERM
 *   /bg clean <name|id>         remove a finished task's worktree
 *
 * State: ~/.pi/agent/bg/<id>.json + <id>.log. The log is the single
 * source of truth; the json tracks pid/status for the footer `bg ●N`
 * gauge and orphan reconciliation (pi quit while a bg ran → "lost").
 * The bg session itself lands in ~/.pi/agent/sessions/ like any other.
 */

import { execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface BgTask {
	id: string;
	name: string;
	task: string;
	/** Working directory of the subprocess — the worktree path in -w mode. */
	cwd: string;
	pid: number;
	startedAt: number;
	status: "running" | "done" | "failed" | "killed" | "lost";
	exitCode?: number;
	endedAt?: number;
	worktree?: { path: string; branch: string; repo: string };
}

const DIR = join(homedir(), ".pi", "agent", "bg");
const STATUS_KEY = "bg";
const MAX_LOG_LINES = 2000;
const PROMPT_PREFIX =
	"You are an autonomous background agent. No user is available — do not ask questions; make reasonable decisions and complete the task. Task: ";

const jsonPath = (id: string) => join(DIR, `${id}.json`);
const logPath = (id: string) => join(DIR, `${id}.log`);

function save(t: BgTask) {
	mkdirSync(DIR, { recursive: true });
	writeFileSync(jsonPath(t.id), JSON.stringify(t, null, 2));
}

function list(): BgTask[] {
	if (!existsSync(DIR)) return [];
	const tasks: BgTask[] = [];
	for (const f of readdirSync(DIR)) {
		if (!f.endsWith(".json")) continue;
		try {
			tasks.push(JSON.parse(readFileSync(join(DIR, f), "utf-8")));
		} catch {
			// Corrupt state file — skip it, the log is still there.
		}
	}
	return tasks.sort((a, b) => b.startedAt - a.startedAt);
}

function find(idOrName: string): BgTask | undefined {
	const tasks = list();
	return (
		tasks.find((t) => t.id === idOrName || t.name === idOrName) ??
		tasks.filter((t) => t.id.startsWith(idOrName) || t.name.startsWith(idOrName)).at(0)
	);
}

function slugify(task: string): string {
	const words = task
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 2)
		.slice(0, 3);
	return words.join("-") || "task";
}

function uniqueName(base: string): string {
	const taken = new Set(list().map((t) => t.name));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function git(args: string, cwd: string): string {
	return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function elapsed(t: BgTask): string {
	const s = Math.floor(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function lastLogLine(id: string): string {
	try {
		const lines = readFileSync(logPath(id), "utf-8").split("\n").filter((l) => l.trim());
		return lines.at(-1)?.trim().slice(0, 80) ?? "";
	} catch {
		return "";
	}
}

/** Footer `bg ●N` gauge — flows into the footer's extension-statuses slot. */
function updateStatus(ctx: ExtensionContext | undefined) {
	if (!ctx?.hasUI) return;
	const running = list().filter((t) => t.status === "running").length;
	ctx.ui.setStatus(STATUS_KEY, running > 0 ? ctx.ui.theme.fg("accent", `bg ●${running}`) : "");
}

/** Mark pid-dead "running" tasks as lost (pi quit before the exit event). */
function reconcile(ctx: ExtensionContext) {
	let lost = 0;
	for (const t of list()) {
		if (t.status !== "running") continue;
		try {
			process.kill(t.pid, 0);
		} catch {
			t.status = "lost";
			t.endedAt = Date.now();
			save(t);
			lost++;
		}
	}
	if (lost > 0 && ctx.hasUI) {
		ctx.ui.notify(`bg: ${lost} task${lost > 1 ? "s" : ""} finished while pi was away — /bg to inspect`, "info");
	}
}

function launch(t: BgTask, ctx: ExtensionContext, getCtx: () => ExtensionContext | undefined) {
	const fd = openSync(logPath(t.id), "a");
	const child = spawn("pi", ["-p", PROMPT_PREFIX + t.task], {
		cwd: t.cwd,
		detached: true, // own process group — survives pi quitting (reconcile picks it up)
		stdio: ["ignore", fd, fd],
	});
	closeSync(fd); // the child holds its own dup of the fd
	t.pid = child.pid ?? 0;
	save(t);

	child.on("error", (err) => {
		// spawn itself failed (e.g. pi not on PATH) — no exit event will follow
		t.status = "failed";
		t.endedAt = Date.now();
		save(t);
		writeFileSync(logPath(t.id), `spawn failed: ${err.message}\n`, { flag: "a" });
		updateStatus(getCtx());
	});

	child.on("exit", (code) => {
		const cur = find(t.id);
		if (!cur || cur.status !== "running") return; // /bg kill already marked it
		cur.status = code === 0 ? "done" : "failed";
		cur.exitCode = code ?? undefined;
		cur.endedAt = Date.now();
		save(cur);
		const c = getCtx();
		if (c?.hasUI) {
			const ok = cur.status === "done";
			const where = cur.worktree ? ` on ${cur.worktree.branch} — review: git diff HEAD...${cur.worktree.branch}` : "";
			c.ui.notify(
				`bg ${ok ? "✓" : "✗"} ${cur.name} (${elapsed(cur)})${where} — /bg show ${cur.name}`,
				ok ? "info" : "error",
			);
		}
		updateStatus(c);
	});
	updateStatus(ctx);
}

/** Log viewer overlay — re-reads every second, tail-f stick-to-bottom. */
async function showLog(t: BgTask, ctx: ExtensionCommandContext) {
	const file = logPath(t.id);
	const read = () => {
		try {
			return readFileSync(file, "utf-8").split("\n").slice(-MAX_LOG_LINES);
		} catch {
			return ["(log not written yet)"];
		}
	};

	await ctx.ui.custom(
		(tui, theme, _kb, done) => {
			let lines = read();
			let offset = 0;
			let follow = true;
			const viewH = Math.max(6, Math.floor((process.stdout.rows ?? 24) * 0.7));

			const maxOffset = () => Math.max(0, lines.length - viewH);
			const timer = setInterval(() => {
				const next = read();
				if (next.length === lines.length && next.at(-1) === lines.at(-1)) return;
				lines = next;
				if (follow) offset = maxOffset();
				tui.requestRender();
			}, 1000);
			const close = () => {
				clearInterval(timer);
				done(undefined);
			};
			const scroll = (n: number) => {
				offset = Math.max(0, Math.min(offset + n, maxOffset()));
				follow = offset >= maxOffset();
				tui.requestRender();
			};

			return {
				invalidate() {},
				render(width: number) {
					const w = Math.max(10, width - 1);
					const sep = theme.fg("dim", "─".repeat(w));
					const live = t.status === "running" ? theme.fg("accent", "● running") : theme.fg("dim", t.status);
					const title = theme.fg("accent", ` bg · ${t.name}`) + theme.fg("dim", ` · ${elapsed(t)} · `) + live;
					const end = Math.min(offset + viewH, lines.length);
					const hint = theme.fg("dim", ` ${offset + 1}–${end} of ${lines.length} · ↑↓/jk scroll · G follow · q close`);
					const body = lines.slice(offset, end).map((l) => truncateToWidth(l, w));
					return [title, sep, ...body, sep, hint];
				},
				handleInput(data: string) {
					if (data === "\x1b" || data === "q") return close();
					if (data === "\x1b[A" || data === "k") scroll(-1);
					else if (data === "\x1b[B" || data === "j") scroll(1);
					else if (data === "\x1b[5~") scroll(-viewH);
					else if (data === "\x1b[6~") scroll(viewH);
					else if (data === "g") scroll(-lines.length);
					else if (data === "G") scroll(lines.length);
				},
				handleMouse(ev) {
					if (ev.type === "wheel" && ev.wheelDelta) {
						scroll(ev.wheelDelta);
						return { handled: true };
					}
					return undefined;
				},
			};
		},
		{ overlay: true, overlayOptions: { width: "85%", maxHeight: "80%", anchor: "center" } },
	);
}

/** Task list overlay — one glance: status dot, name, elapsed, last log line. */
async function showList(ctx: ExtensionCommandContext) {
	const tasks = list().slice(0, 10);
	if (tasks.length === 0) {
		ctx.ui.notify("No bg tasks — /bg <task> to start one", "info");
		return;
	}
	await ctx.ui.custom(
		(tui, theme, _kb, done) => {
			const timer = setInterval(() => tui.requestRender(), 1000); // refresh elapsed/last-line
			const close = () => {
				clearInterval(timer);
				done(undefined);
			};
			const DOT: Record<BgTask["status"], string> = {
				running: theme.fg("accent", "●"),
				done: theme.fg("success", "✓"),
				failed: theme.fg("error", "✗"),
				killed: theme.fg("warning", "■"),
				lost: theme.fg("dim", "?"),
			};
			return {
				invalidate() {},
				render(width: number) {
					const w = Math.max(10, width - 1);
					const sep = theme.fg("dim", "─".repeat(w));
					const out = [theme.fg("accent", " bg agents"), sep];
					for (const t of tasks) {
						out.push(
							truncateToWidth(
								`${DOT[t.status]} ${theme.fg("accent", t.name)} ${theme.fg("dim", `(${t.id}) ${elapsed(t)} · ${t.task}`)}`,
								w,
							),
						);
						const last = t.status === "running" ? lastLogLine(t.id) : "";
						if (last) out.push(truncateToWidth(theme.fg("dim", `  ${last}`), w));
					}
					out.push(sep, theme.fg("dim", " /bg show <name> · /bg kill <name> · q close"));
					return out;
				},
				handleInput(data: string) {
					if (data === "\x1b" || data === "q") return close();
				},
			};
		},
		{ overlay: true, overlayOptions: { width: "85%", maxHeight: "80%", anchor: "center" } },
	);
}

export default function bg(pi: ExtensionAPI) {
	// Latest tui context, so subprocess exit handlers can notify/updateStatus
	// even after a session switch invalidated the launching context.
	let uiCtx: ExtensionContext | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") {
			uiCtx = ctx;
			reconcile(ctx);
			updateStatus(ctx);
		}
	});

	pi.registerCommand("bg", {
		description: "Background agents — /bg <task> · /bg -w <task> · /bg · /bg show|kill|clean <name>",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/bg needs interactive mode", "error");
				return;
			}
			const parts = args.trim().split(/\s+/).filter(Boolean);

			if (parts.length === 0) return showList(ctx);

			if (parts[0] === "show" || parts[0] === "kill" || parts[0] === "clean") {
				const [action, target] = parts;
				if (!target) {
					ctx.ui.notify(`Usage: /bg ${action} <name|id>`, "info");
					return;
				}
				const t = find(target);
				if (!t) {
					ctx.ui.notify(`No bg task matching "${target}" — /bg to list`, "error");
					return;
				}
				if (action === "show") return showLog(t, ctx);
				if (action === "kill") {
					if (t.status !== "running") {
						ctx.ui.notify(`${t.name} is already ${t.status}`, "warning");
						return;
					}
					try {
						process.kill(t.pid, "SIGTERM");
					} catch {
						// already dead — still mark it
					}
					t.status = "killed";
					t.endedAt = Date.now();
					save(t);
					updateStatus(ctx);
					ctx.ui.notify(`bg ■ ${t.name} killed`, "info");
					return;
				}
				// clean
				if (!t.worktree) {
					ctx.ui.notify(`${t.name} has no worktree (shared-tree task)`, "warning");
					return;
				}
				if (t.status === "running") {
					ctx.ui.notify(`${t.name} is still running — /bg kill ${t.name} first`, "warning");
					return;
				}
				try {
					git(`worktree remove --force "${t.worktree.path}"`, t.worktree.repo);
					ctx.ui.notify(`Worktree removed — branch ${t.worktree.branch} kept for your review`, "info");
				} catch (e) {
					ctx.ui.notify(`Cleanup failed: ${(e as Error).message}`, "error");
				}
				return;
			}

			// Launch: /bg [-w] [-n name] <task...>
			let worktreeMode = false;
			let name: string | undefined;
			const rest: string[] = [];
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === "-w") worktreeMode = true;
				else if (parts[i] === "-n") name = parts[++i];
				else rest.push(parts[i]);
			}
			const task = rest.join(" ").trim();
			if (!task) {
				ctx.ui.notify("Usage: /bg [-w] [-n name] <task>", "info");
				return;
			}

			const id = randomBytes(2).toString("hex");
			name = uniqueName(name ?? slugify(task));
			let cwd = ctx.cwd;
			let worktree: BgTask["worktree"];

			if (worktreeMode) {
				const wtPath = join(DIR, `${id}-tree`);
				const branch = `bg/${name}`;
				try {
					git(`worktree add "${wtPath}" -b ${branch} HEAD`, ctx.cwd);
				} catch (e) {
					ctx.ui.notify(`Worktree failed: ${(e as Error).message}`, "error");
					return;
				}
				cwd = wtPath;
				worktree = { path: wtPath, branch, repo: ctx.cwd };
			} else {
				// Shared tree: bg sees your dirty state — make that an explicit choice.
				let dirty = "";
				try {
					dirty = git("status --porcelain", ctx.cwd);
				} catch {
					// not a git repo — nothing to collide with
				}
				if (dirty) {
					const files = dirty.split("\n");
					const preview = files.slice(0, 5).join("\n");
					const more = files.length > 5 ? `\n… and ${files.length - 5} more` : "";
					const ok = await ctx.ui.confirm(
						"Uncommitted changes",
						`bg will see and may touch these files:\n${preview}${more}\n\nContinue in shared tree? (-w for isolation)`,
					);
					if (!ok) return;
				}
			}

			const t: BgTask = {
				id,
				name,
				task,
				cwd,
				pid: 0,
				startedAt: Date.now(),
				status: "running",
				worktree,
			};
			launch(t, ctx, () => uiCtx);
			ctx.ui.notify(`bg ● ${name} started — /bg show ${name} to watch`, "info");
		},
	});
}
