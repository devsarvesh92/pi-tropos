# pi-tropos

τρόπος (tropos) — *way, manner, style*. My way of pi.

Personal pi customization bundle. One package, installable anywhere.

## Features

- **Dumb-zone detection** — footer status `ctx Nk · N%`, colored dim → yellow → red
  by the 100k-tokens / 40%-of-window rule (warns from 80% of that line).
  When a run settles in the dumb zone, a one-time confirm offers to auto-run `/fresh`;
  decline suppresses it until the session drops out of the dumb zone.
- **`/fresh`** — summarize the current session, edit the summary, continue in a fresh
  session seeded with it. Old session preserved and linked via `parentSession`.
- **`/sessions [all]`** — browse and resume past sessions (project-scoped or everything).
  Unnamed sessions are auto-named from the first user message.
- **`commandcode` theme** — dark monochrome inspired by commandcode.ai: onyx background
  (`#0B0B0C`), off-white text (`#E4E4E7`), slate-grey chrome, and color reserved for
  diagnostics (mint `#4EFAAA` success, amber `#F59E0B` warning, crimson `#EF4444` error).
  Select via `/settings` or `"theme": "commandcode"` in `settings.json`.
- **`kaapi` theme** — filter-coffee dark: deep espresso base (`#15100D`), latte-foam text
  (`#E8DCCB`), caramel accent (`#D9984A`), matcha success, terracotta error. Warm and
  caffeinated. Select via `/settings` or `"theme": "kaapi"`.
- **Clean footer** — one line: `project branch` left; `in · out · cached · stored · $cost`
  plus the dumbzone `ctx` gauge right. Zero-valued counters hide; no full paths, no
  cache-hit %, no session titles. Auto-named sessions are sanitized (no markdown junk).
  `ctx` is the live context snapshot; the others are cumulative session billing counters
  (`cached`/`stored` = provider prompt-cache reads/writes, re-read every turn). The
  counter with the highest share of session spend is highlighted in the accent color —
  typically `cached`, which is why keeping ctx small (the dumb-zone rule) also saves money.
- **`/zen` mode** — reading mode for brainstorming: collapses all tool output and shrinks
  the footer to `$cost` + the ctx gauge. `/zen` again restores your previous state.
- **`/bg` background agents** — run a task in a detached `pi -p` subprocess while you keep
  working. `/bg <task>` shares the working tree (confirms first when it's dirty);
  `/bg -w <task>` isolates in a git worktree on branch `bg/<name>`. `/bg` lists live tasks
  (elapsed + last log line), `/bg show <name>` follows the log tail-f style, `/bg kill`,
  `/bg clean`. Footer shows `bg ●N` while any run; you're notified on completion. Tasks get
  task-derived names (`/bg -n` to override); bg sessions land in `/sessions all` too.
- **`/peek <path>`** — transient code viewer: syntax-highlighted, line-numbered overlay.
  Scroll with ↑/↓/jk/PgUp/PgDn/g/G, Esc or q closes. Leaves no trace in the chat.
- **Barista mascot** — the working spinner becomes a steaming cup of kaapi; every other
  brew cycle it's a boba 🧋. Hidden thinking blocks read "Steeping…".
- **pi-smritikosh** — semantic codebase search, bundled as a dependency. One install
  gets everything; don't also install `npm:pi-smritikosh` separately or it loads twice.

## Install

```bash
pi install npm:pi-tropos                                   # from npm
pi install git:github.com/devsarvesh92/pi-tropos           # from git
pi -e /path/to/oh-my-pi                                    # try once, no install
```

## Develop

```bash
npm install
npm run typecheck
```

No build step — pi loads the TypeScript directly.

## Font (recommended)

pi inherits the terminal's font — it can't set one. In VS Code (where pi usually runs):

```jsonc
// settings.json
"terminal.integrated.fontFamily": "JetBrains Mono",
"terminal.integrated.fontSize": 14,
"terminal.integrated.lineHeight": 1.35,
"terminal.integrated.fontLigatures.enabled": true
```

Good code-reading fonts: **JetBrains Mono** (free, tall x-height, superb at small sizes —
`brew install --cask font-jetbrains-mono`), **SF Mono** (preinstalled on macOS),
**Monaspace Neon** (GitHub's family — `brew install --cask font-monaspace`), **Berkeley
Mono** (paid, beautiful). Size 13–14 + lineHeight 1.3–1.4 is the biggest readability win.
