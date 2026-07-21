# smashhh — Design

smashhh is a multi-agent orchestrator for building big projects (typically SaaS).
It coordinates three roles — **planner**, **coder**, **verifier** — each filled by
a coding-agent harness (**pi**, **codex**, or **claude**) running in its own tab
of a dedicated [Herdr](https://github.com/herdr) workspace. The human (you) talks
to smashhh itself through a pi session.

## Core flow

```
1. INTERVIEW (smashhh ↔ user, conversational)
   - What is the project about?
   - Where should the repo live?
   - Which harness (+ model) for planner / coder / verifier?
   - Git mode: branch-per-story (default) or all-on-main ("fast mode")?
   - Per-story review gate: on or off?

2. SCAFFOLD (smashhh, via herdr CLI)
   - Create repo folder, git init
   - Write AGENTS.md, docs/, stories/, handoff/
   - Write the project brief to docs/PROJECT.md
   - Create a new Herdr workspace rooted at the repo, one tab per role
   - Launch the three agents (interactive TUI, model chosen via launch flag)
   - Wait for each agent to report idle, then send it its role assignment

3. PLAN
   - Planner writes high-level story breakdown → stories/stories.md
   - USER REVIEW GATE: greenlight required before any code is written

4. ITERATION LOOP (per story)
   a. Planner writes the detailed story → stories/story-NN.md
      and the assignment snapshot → handoff/planner_handoff.md
   b. Coder implements the story → handoff/coder_report.md
   c. Verifier tests against the story's acceptance criteria
      → handoff/verifier_report.md
      - PASS → merge/PR story branch into main (or just continue, in fast mode)
      - FAIL → back to (b) with the verifier report; after 2 failed attempts,
        escalate to the user
   d. Optional USER GATE: pause for review after each story (if enabled)

5. DONE — plan exhausted, final summary
```

## Roles and personas

The three personas live in [personas/](../personas/) (`planner.md`, `coder.md`,
`verifier.md`). They are distilled from existing public agent collections —
[wshobson/agents](https://github.com/wshobson/agents) (`team-lead`,
`team-implementer`, `team-reviewer`, `task-decomposition`) and
[contains-studio/agents](https://github.com/contains-studio/agents)
(`sprint-prioritizer`, `test-writer-fixer`) — kept **short and sharp**: a role
paragraph, a workflow, a file-format contract, and a handful of reflexes. The
scaffolding (file contracts below) carries most of the process weight.

- **Planner** — seasoned engineering PM + staff engineer. Breaks the project
  into high-level stories, then writes one *thorough* detailed story per
  iteration. Every story is sized to fit in a single agent context window and
  carries explicit, testable acceptance criteria.
- **Coder** — pragmatic senior engineer. Sees only the detailed story
  (`handoff/planner_handoff.md`), implements it, reports what it did.
- **Verifier** — skeptical QA/release engineer. Tests the implementation
  against the story's acceptance criteria, not against the coder's claims.
  On PASS in branch-per-story mode, merges the story branch into main.

## Repo layout (of every project smashhh creates)

```
<project>/
  AGENTS.md                  # role contracts, file protocol, sentinel rule
                             # (generated from templates/AGENTS.md)
  .smashhh/
    personas/                # planner.md, coder.md, verifier.md (copied from smashhh)
  docs/
    PROJECT.md               # the project brief from the interview
    ...                      # design docs the agents produce along the way
  stories/
    stories.md               # high-level breakdown (planner, once, user-approved)
    story-01.md              # detailed story per iteration (planner)
    story-02.md
    ...
  handoff/
    planner_handoff.md       # current story assignment (planner → coder)
    coder_report.md          # implementation report (coder → verifier)
    verifier_report.md       # test report + verdict (verifier → smashhh/user)
```

Handoff files are **overwritten each iteration** — they are a snapshot of the
current exchange, not a log. Stories and docs accumulate.

**Key principle:** handoff files are the source of truth, not chat memory.
Agents must assume their context can be compacted or truncated at any time.

## Completion signaling

No per-harness hooks (pi extensions / claude hooks / codex notify). Two
mechanisms, both harness-agnostic:

1. **Herdr agent-status detection** (primary). Herdr natively detects
   `working` / `blocked` / `done` / `idle` for pi, codex, and claude.
   smashhh drives each step as:

   ```bash
   herdr pane run <pane> "<task>"
   herdr wait agent-status <pane> --status working --timeout 30000
   herdr wait agent-status <pane> --status done --timeout 600000   # or idle
   herdr pane read <pane> --source recent-unwrapped --lines 80
   ```

   `blocked` means the agent needs input — surface it to the user.

2. **Sentinel line** (disambiguation, mandated in AGENTS.md). Each agent ends
   a completed task turn with:

   ```
   SMASHHH_TASK_COMPLETE: <one-line summary>
   ```

   so smashhh can `herdr wait output <pane> --match SMASHHH_TASK_COMPLETE` and
   tell "finished" apart from "paused mid-thought".

## Agent ↔ smashhh mapping

- **One tab per role, always.** Harness reuse across roles (e.g. Claude as both
  planner and verifier in one pane) is **dropped for now** — it complicates the
  topology and mixes contexts. Three roles → three panes. The same *harness*
  may fill multiple roles; it just runs as separate instances.
- smashhh tracks `role → pane_id` and routes every prompt through
  `herdr pane run`.
- Models are selected at launch time via CLI flags (`claude --model`,
  `codex -m`, `pi --model`) — exact flag names to be verified per harness —
  rather than relying on in-TUI `/model` commands.

## Git strategy

- **Branch per story (default).** Coder works on `story-NN-<slug>`; verifier
  greenlight is the signal to open a PR / merge into `main`.
- **Fast mode (optional).** Everything on `main`, commit after each verified
  story, no PRs. For going fast on solo projects.
- Either way, a story only lands on `main` after the verifier passes it.

## Human-in-the-loop

- **Mandatory gate:** user reviews and greenlights `stories/stories.md`
  before the first iteration starts.
- **Optional gate:** pause for user review after each completed story
  (chosen during the interview).
- **Escalation:** verifier rejects the same story twice → smashhh stops and
  asks the user how to proceed.
- User can also just talk to smashhh at any time; smashhh relays steering
  instructions to the right pane.

## What smashhh is, physically

A pi skill + supporting scripts **in this repo**. You open pi inside Herdr,
say "smashhh: new project", and the interview, scaffolding, and loop all run
through that conversation — which makes the review gates and steering natural
chat interactions. The heavy lifting (workspace/tab/pane management, status
waits, transcript reads) goes through the `herdr` CLI per the herdr skill.

## Open tasks

- [x] Research existing planner/coder/verifier persona prompts & skills;
      distill into three short persona blocks → [personas/](../personas/)
- [ ] Verify model-selection launch flags for pi, codex, claude
- [x] Write the AGENTS.md template (roles, file protocol, sentinel rule)
      → [templates/AGENTS.md](../templates/AGENTS.md)
- [ ] Write the kickoff prompts (role assignment + first task per role)
- [ ] Implement the smashhh skill: interview → scaffold → loop
- [ ] Define the verifier's PASS merge/PR mechanics (gh CLI? local merge?)
- [ ] Dogfood: build smashhh's own first real project with smashhh
