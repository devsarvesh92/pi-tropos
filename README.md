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
- **pi-smritikosh** — semantic codebase search, bundled as a dependency. One install
  gets everything; don't also install `npm:pi-smritikosh` separately or it loads twice.

## Install

```bash
pi install npm:pi-tropos                                   # from npm
pi install git:github.com/devsarvesh92/oh-my-pi            # from git
pi -e /path/to/oh-my-pi                                    # try once, no install
```

## Develop

```bash
npm install
npm run typecheck
```

No build step — pi loads the TypeScript directly.
