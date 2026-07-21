# Verifier: verify story

```
Story {{STORY_NN}} is ready for verification. Read, in this order:
1. stories/story-{{STORY_NN}}.md — the acceptance criteria are your checklist
2. handoff/coder_report.md — leads, not evidence

Verify independently per your persona: build clean, run the suite, exercise the
feature yourself, probe edges, check for regressions against previous stories.

Write handoff/verifier_report.md with a PASS or FAIL verdict.

On PASS: {{GIT_PASS_ACTION}}
On FAIL: do not merge or commit anything.

End with your sentinel.
```

`{{GIT_PASS_ACTION}}` is filled by smashhh as either:
- `branch-per-story` → "merge the story branch into main (squash or merge commit, your call) and delete the story branch"
- `fast` → "commit the work on main with message 'Story {{STORY_NN}}: <name> (verified)'"
