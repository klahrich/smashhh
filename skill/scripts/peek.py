#!/usr/bin/env python3
"""smashhh peek: compact per-pane digest for a Herdr workspace.

Usage: peek.py <workspace_id> [tail_lines]

Prints one short block per pane: id, agent, status, and the last meaningful
transcript lines (TUI chrome filtered out). Intended to be run by the
orchestrator at the user's chosen interval while agents are working.
"""
import json
import subprocess
import sys


def herdr_json(*args):
    out = subprocess.run(["herdr", *args], capture_output=True, text=True)
    try:
        return json.loads(out.stdout).get("result", {})
    except json.JSONDecodeError:
        return {}


def herdr_text(*args):
    return subprocess.run(["herdr", *args], capture_output=True, text=True).stdout


def is_chrome(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if set(s) <= set("─━═- "):  # TUI rule lines
        return True
    if "↑" in s and "↓" in s and "$" in s:  # pi status bar
        return True
    if "Working..." in s:  # spinner line
        return True
    if s.startswith("~") and s.endswith(")") and "(" in s:  # cwd (branch) line
        return True
    return False


def main() -> None:
    ws = sys.argv[1]
    tail = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    panes = herdr_json("pane", "list", "--workspace", ws).get("panes", [])
    for p in panes:
        pid = p.get("pane_id", "?")
        agent = p.get("agent") or "shell"
        status = p.get("agent_status", "?")
        title = p.get("terminal_title_stripped") or ""
        text = herdr_text("pane", "read", pid, "--source", "recent-unwrapped",
                          "--lines", str(tail))
        meaningful = [l.strip() for l in text.splitlines() if not is_chrome(l)]
        print(f"{pid} [{agent}/{status}] {title}")
        for line in meaningful[-2:]:
            print(f"   {line[:140]}")
    if not panes:
        print(f"no panes found in workspace {ws}")


if __name__ == "__main__":
    main()
