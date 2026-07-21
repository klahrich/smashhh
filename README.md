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

## License

[MIT](LICENSE)
