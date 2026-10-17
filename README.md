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
- **Clean footer** — one line: `project branch` left; `↑in ↓out Rcache Wcache $cost` plus
  the dumbzone gauge right. Zero-valued counters hide; no full paths, no cache-hit %,
  no session titles. Auto-named sessions are sanitized (no markdown table junk).
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
