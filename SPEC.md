# Requirements — pi-tropos

## Functional

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-1 | **Dumb-zone detection** — continuously indicate context health so the user knows when LLM quality is degrading | Footer status `ctx Nk · N%`, dim → yellow → red |
| FR-1a | **Threshold rule** — dumb zone = ≥100k tokens OR ≥40% of context window, whichever hits first; warning from 80% of that line | Constants in `dumbzone.ts` |
| FR-1b | **Prompt once** when a run settles in the dumb zone — confirm dialog offers to auto-run `/fresh`; decline = stay, won't re-ask | `agent_settled` + `pi.sendUserMessage("/fresh")`; re-arms after compaction/new session |
| FR-2 | **Escape hatch** — one command to fork the work: summarize current session, review/edit summary, start a new session seeded with it; old session preserved and linked | `/fresh` command, `parentSession` link |
| FR-3 | **Persist all sessions** | Pi persists every session to `~/.pi/agent/sessions/` natively |
| FR-3a | **Session browser** — clean picker to find and resume past sessions | `/sessions` (project), `/sessions all` (everything) |
| FR-3b | **Auto-name sessions** from first message for readable browsing | After turn 1, if unnamed |
| FR-4 | **Background agent** — run an execution task in a background agent while continuing in the foreground; notify on completion; inspectable afterwards | Implemented: `/bg` (shared tree, dirty-confirm), `/bg -w` (worktree isolation), `/bg show` follow-mode log, `/bg kill`/`clean`, footer `bg ●N`, orphan reconcile. Collision policy: shared-by-default with confirm, `-w` for isolation |
| FR-5 | **Clean theme** — look & feel inspired by commandcode.ai | `commandcode` theme in `themes/` — onyx monochrome (#0B0B0C/#E4E4E7) with mint/amber/crimson diagnostics |
| FR-6 | **Reading mode** — clean, low-noise view for brainstorming | Implemented: `/zen` toggle — collapses tool output, footer shrinks to cost + ctx gauge; restores prior state on exit |
| FR-7 | **Font** — change pi's font | Done: terminal-level setting; recommendations documented in README (VS Code `terminal.integrated.*`) |
| FR-8 | **TDD lock** — make test-first mechanically true, not merely requested | Implemented: `/tdd` + `tool_call` path gate. RED blocks source edits, GREEN freezes tests; phase advances only on a real exit code via `tdd_check`. Model cannot unlock itself (command, not tool) |
| FR-9 | **`/feature` → `/execute` workflow** — plan in chat, build in background | Design agreed. `/feature <desc>`: fresh session (confirm if current has content) → scout-planner agent (smritikosh-driven, isolated) → plan in editor → optional GitHub/JIRA ticket → plan saved to `.pi/feature/<slug>.md`. Handoff is manual: `/execute <slug>` = `/bg -w --tdd --pr`, branch `bg/PROJ-123-<slug>`. Two agents only: scout-planner (context compression), reviewer (independence) |

## Non-functional

| ID | Requirement |
|----|-------------|
| NFR-1 | No AI slop — minimal code, no speculative features |
| NFR-2 | One commit per feature, clean history |
| NFR-3 | Brainstorm each feature before implementing, one at a time |
| NFR-4 | Extension auto-loads from `~/.pi/agent/extensions/` |
