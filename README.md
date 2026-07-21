# smashhh

**Multi-agent orchestrator for building big projects.** smashhh coordinates
three roles — planner, coder, verifier — each filled by a coding-agent harness
([pi](https://github.com/earendil-works/pi), [codex](https://github.com/openai/codex),
or [claude](https://github.com/anthropics/claude-code)) running in its own tab
of a dedicated [Herdr](https://github.com/anomaly/herdr) workspace.

You describe the project; smashhh scaffolds the repo, spawns the agents,
assigns their roles, and drives the loop:

```
plan → (you approve) → detailed story → implement → verify → merge → next story
```

Agents communicate through files, not chat memory:

```
stories/    high-level breakdown + one detailed story per iteration
handoff/    planner_handoff.md → coder_report.md → verifier_report.md
docs/       project brief and design docs
```

See [docs/design.md](docs/design.md) for the full design.

## Status

Early design phase. See the open tasks in [docs/design.md](docs/design.md).

## Usage

smashhh is a [pi](https://github.com/earendil-works/pi) skill. It must run
inside a [Herdr](https://github.com/anomaly/herdr) session (`HERDR_ENV=1`).

Install by linking the skill folder into your pi skills directory:

```powershell
# Windows (PowerShell, admin or developer mode for symlinks)
New-Item -ItemType SymbolicLink -Path "$HOME\.agents\skills\smashhh" -Target "<path-to-this-repo>\skill"
```

```bash
# or just copy it
cp -r <path-to-this-repo>/skill ~/.agents/skills/smashhh
```

Then, from any pi session inside Herdr: **"smashhh: new project"**. smashhh
will interview you (project, location, harness + model per role, git mode,
review gates), scaffold the repo, spawn the team, and drive the loop.

## License

[MIT](LICENSE)
