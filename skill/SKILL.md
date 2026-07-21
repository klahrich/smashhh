---
name: smashhh
description: Orchestrate a multi-agent build (planner + coder + verifier, each a pi/codex/claude instance in a Herdr workspace) for a new big project. Use when the user says "smashhh", asks to start/scaffold a new project with the planner/coder/verifier team, or wants to resume an existing smashhh project. Requires HERDR_ENV=1.
---

# smashhh

Orchestrate a three-role agent team — **planner**, **coder**, **verifier** —
building a project in a dedicated Herdr workspace. You (the pi session the user
is talking to) are the **orchestrator**: you interview the user, scaffold the
repo, spawn the agents, route tasks between them, and enforce the gates.

The design rationale lives in `docs/design.md` in the smashhh repository; the
files you will copy and render live in `templates/` and `personas/` next to
this SKILL.md. Resolve those paths relative to this skill's directory. Read
them before scaffolding.

## Preflight

```bash
test "${HERDR_ENV:-}" = 1   # must pass; otherwise stop and say so
```

Also confirm the `herdr` CLI is in PATH and note your own pane context
(`HERDR_WORKSPACE_ID`, `HERDR_PANE_ID`) so you never confuse your pane with a
teammate pane.

## Step 1 — Interview

Ask the user, conversationally (batch the questions, don't drip-feed):

1. **Project**: what is it about? Probe enough to write a solid
   `docs/PROJECT.md` (goal, users, core features, constraints, preferred stack
   if any). Offer to draft it and let them amend.
2. **Location**: absolute path where the repo should live.
3. **Cast**: harness + model for each role — planner, coder, verifier.
   Harnesses: `pi`, `codex`, `claude`. The same harness may fill several roles
   (each gets its own instance and tab). Launch flags:
   `pi --model <m>`, `codex -m <m>`, `claude --model <m>`.
   If the user has no model preference, omit the flag (harness default).
4. **Git mode**: `branch-per-story` (default; verifier merges on PASS) or
   `fast` (all on main, verifier commits on PASS).
5. **Per-story gate**: pause for user review after each verified story?
   (default: no — hands-off until the plan is exhausted or escalation)
6. **Progress peeks**: while agents work, do you want periodic digests of what
   each pane is doing, and at what interval in minutes? (default: on, every 5
   minutes — see "Progress peeks" below)

Confirm the full configuration back to the user before proceeding.

## Step 2 — Scaffold the repo

```bash
mkdir -p <path> && cd <path> && git init -b main
mkdir -p docs stories handoff .smashhh/personas
```

Then:

1. Copy `personas/{planner,coder,verifier}.md` → `.smashhh/personas/`.
2. Render `templates/AGENTS.md` → `AGENTS.md`: replace `{{PROJECT_NAME}}`
   and `{{GIT_MODE}}`.
3. Write `docs/PROJECT.md` from the interview.
4. Commit: `git add -A && git commit -m "smashhh: project scaffold"`.

## Step 3 — Spawn the team

```bash
herdr workspace create --cwd <path> --label <project-slug> --no-focus
# → note workspace_id (e.g. w3). A first tab/pane already exists in it.
herdr tab create --workspace <w> --label coder --no-focus
herdr tab create --workspace <w> --label verifier --no-focus
herdr pane list --workspace <w>     # map role → pane_id; rename tabs:
herdr tab rename <w:t1> planner
```

Record the mapping immediately in `<path>/.smashhh/state.json`:

```json
{
  "project": "<name>", "workspace_id": "w3",
  "roles": {"planner": "w3:p1", "coder": "w3:p2", "verifier": "w3:p3"},
  "git_mode": "branch-per-story", "per_story_gate": false,
  "peek_interval_min": 5,
  "phase": "spawned", "current_story": 0, "attempt": 0
}
```

Update this file at every phase transition — it is how you resume after a
session break.

Launch each agent in its pane and wait for it to be ready:

```bash
herdr pane run <planner-pane> "pi --model <model>"     # or: codex -m <m> / claude --model <m>
herdr wait agent-status <planner-pane> --status idle --timeout 120000
```

Repeat for coder and verifier. Then send each its kickoff from
`templates/prompts/<role>-kickoff.md` (fill `{{PROJECT_NAME}}`,
`{{GIT_MODE}}`):

```bash
herdr pane run <planner-pane> "<planner kickoff text>"
herdr wait agent-status <planner-pane> --status working --timeout 30000
herdr wait agent-status <planner-pane> --status done --timeout 1200000   # or idle
```

Send coder/verifier kickoffs in parallel with the planner's (their orientation
is quick). Wait for all three to complete.

## Step 4 — Plan gate

When the planner completes its kickoff task:

1. Read `<path>/stories/stories.md` and present it to the user.
2. Collect feedback; relay revisions to the planner with `pane run`, wait for
   completion, re-present. Repeat until the user greenlights.
3. Set `state.json` → `"phase": "iterating"`.

## Step 5 — Iteration loop

For each story N (1, 2, 3, ...), in order, until the plan is exhausted:

```bash
# a. planner writes the detailed story
herdr pane run <planner> "<planner-write-story prompt, STORY_NN=N>"
# wait working → done; confirm stories/story-N.md + handoff/planner_handoff.md exist

# b. coder implements  (attempt = 1)
herdr pane run <coder> "<coder-implement prompt, STORY_NN=N + git instructions>"
# wait; confirm handoff/coder_report.md exists

# c. verifier verifies
herdr pane run <verifier> "<verifier-verify prompt, STORY_NN=N + PASS git action>"
# wait; read handoff/verifier_report.md verdict
```

- **PASS** → confirm the merge/commit landed on main
  (`git -C <path> log --oneline -3`), set `attempt: 0`, `current_story: N`.
  If `per_story_gate`, summarize and wait for user go-ahead before (a) of N+1.
- **FAIL** → if `attempt < 2`: increment `attempt`, send
  `coder-fix` prompt, go to (c). If `attempt == 2`: **stop and escalate** —
  show the user the verifier report and the story, ask how to proceed
  (retry / replan via planner / human takes over).

When all stories are done: final summary to the user (what was built, where,
how to run it), `"phase": "done"`.

## Progress peeks

While any teammate agent is `working`, report a compact digest to the user at
the configured interval (`peek_interval_min` in state.json; 0/off = disabled):

```bash
python <skill-dir>/scripts/peek.py <workspace_id>
```

Structure long waits around it: instead of one blocking `herdr wait`, poll in
intervals — run the peek, print the digest (keep it raw and short; add at most
one line of interpretation), then continue waiting. The user can steer this at
any time ("peek on/off", "peek every 2") — update state.json and apply it from
the next interval onward. Peeks are read-only; never let them delay a
completion you should be reacting to.

## Driving rules

- **Waits**: never wait with a bare `sleep` — you will miss completions and
  react late. Use the **reactive wait-loop**: poll `herdr pane get` every
  ~10s inside one bash command, break as soon as the status is not `working`
  (`done` and `idle` both mean completed; `blocked` means the agent needs
  input — read the pane and surface it), and run a progress peek at each
  configured interval from inside the same loop. Prefer this over
  `herdr wait agent-status --status done`, which matches only one status and
  can time out even though the agent finished (it completed as `idle`).
  Example:

  ```bash
  pane=w6:p2; peek_every=300; last=0; deadline=$((SECONDS+3600))
  while [ $SECONDS -lt $deadline ]; do
    st=$(herdr pane get $pane | python -c "import json,sys;print(json.load(sys.stdin)['result']['pane']['agent_status'])")
    [ "$st" != "working" ] && { echo "FINISHED: $st"; break; }
    [ $((SECONDS-last)) -ge $peek_every ] && { python <skill-dir>/scripts/peek.py <workspace>; last=$SECONDS; }
    sleep 10
  done
  ```

  Size the deadline to the task (planner ~10 min, coder 30–60 min).
- **Sentinel check**: after completion, `herdr pane read <pane> --source
  recent-unwrapped --lines 40` and look for the completion line defined in
  AGENTS.md. Absent sentinel + done status = agent stopped early; read more
  transcript before proceeding. Never put the sentinel string itself into a
  prompt you send (terminal echo false-matches `wait output`).
- **Verify files, not just statuses**: each step's contract is a file in
  `handoff/` or `stories/`. If the file is missing or malformed, send the
  agent back to finish before moving on.
- **Quote for PowerShell**: panes are PowerShell on Windows — quote colons and
  spaces in commands.
- **Steering**: the user may interject at any time. Relay their message to the
  relevant pane with `pane run`, then resume the loop.
- **Resume**: if invoked on a project that already has `.smashhh/state.json`,
  read it, verify the workspace/panes still exist (`herdr pane list
  --workspace <w>`), and pick up at the recorded phase. If panes are gone,
  tell the user and offer to re-spawn the team in a fresh workspace.

## Safety

- Never close workspaces/tabs/panes you did not create for this project.
- Never `herdr server stop`. Never kill the main Herdr process.
- Use `--no-focus` for everything unless the user asks to watch.
- Teardown (only when the user asks): close the project workspace via
  `herdr workspace close <w>`; the repo on disk is the deliverable.
