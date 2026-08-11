#!/usr/bin/env python3
"""Answers one question with evidence: did this session actually route, or did Opus do it all?

Reads the transcripts Claude Code already writes and reports token volume per model and
per role. Subagent turns are NOT in the session transcript — they live in
`<session-id>/subagents/agent-<id>.jsonl`, with the role in the sibling `.meta.json`.
Reading only the session file reports 100% Opus even when routing worked perfectly, so
this script reads both.

A healthy routed session shows the bulk of output tokens on the cheap models. One model
and zero subagent transcripts means nothing was routed, whatever the plan said.

Usage:
  python3 .claude/hooks/routing_audit.py            # latest session
  python3 .claude/hooks/routing_audit.py --all      # every session for this project
  python3 .claude/hooks/routing_audit.py --sessions 5
"""
import argparse
import glob
import json
import os
import sys
from collections import defaultdict

PROJECT = os.path.abspath(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def transcript_dir() -> str:
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", PROJECT.replace("/", "-"))


def tally(path: str):
    """-> (models -> {out, in, cache_read, turns})"""
    stats = defaultdict(lambda: {"out": 0, "in": 0, "cache_read": 0, "turns": 0})
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            row = json.loads(line)
        except Exception:
            continue
        msg = row.get("message")
        if not isinstance(msg, dict) or not msg.get("usage"):
            continue
        u = msg["usage"]
        s = stats[msg.get("model") or "unknown"]
        s["out"] += u.get("output_tokens", 0)
        s["in"] += u.get("input_tokens", 0)
        s["cache_read"] += u.get("cache_read_input_tokens", 0)
        s["turns"] += 1
    return stats


def subagent_runs(session_path: str):
    """-> [(role, path)] for every subagent spawned by this session."""
    base = session_path[: -len(".jsonl")]
    runs = []
    for path in sorted(glob.glob(os.path.join(base, "subagents", "agent-*.jsonl"))):
        role = "?"
        try:
            with open(path[: -len(".jsonl")] + ".meta.json", encoding="utf-8") as fh:
                role = json.load(fh).get("agentType") or "?"
        except Exception:
            pass
        runs.append((role, path))
    return runs


def report(paths) -> int:
    by_model = defaultdict(int)
    by_role = defaultdict(lambda: {"runs": 0, "out": 0})
    row = "{:<24}{:<22}{:>7}{:>12}{:>12}{:>14}"

    for session in paths:
        print(f"\n=== session {os.path.basename(session)[:8]}")
        print(row.format("role", "model", "turns", "out", "in", "cache_read"))
        for model, s in sorted(tally(session).items(), key=lambda kv: -kv[1]["out"]):
            print(row.format("main", model, s["turns"], f"{s['out']:,}", f"{s['in']:,}", f"{s['cache_read']:,}"))
            by_model[model] += s["out"]
            by_role["main"]["out"] += s["out"]

        runs = subagent_runs(session)
        by_role["main"]["runs"] = 1
        for role, path in runs:
            for model, s in sorted(tally(path).items(), key=lambda kv: -kv[1]["out"]):
                print(row.format(role, model, s["turns"], f"{s['out']:,}", f"{s['in']:,}", f"{s['cache_read']:,}"))
                by_model[model] += s["out"]
                by_role[role]["out"] += s["out"]
            by_role[role]["runs"] += 1
        if not runs:
            print("  (no subagent transcripts — nothing was routed in this session)")

    grand = sum(by_model.values())
    if not grand:
        print("No usage found in the selected transcripts.")
        return 1

    print("\n--- output tokens by model (the routing verdict) ---")
    for model, out in sorted(by_model.items(), key=lambda kv: -kv[1]):
        print(f"  {model:<28}{out:>10,}  {out / grand:6.1%}")

    print("\n--- by role ---")
    for role, s in sorted(by_role.items(), key=lambda kv: -kv[1]["out"]):
        print(f"  {role:<28}{s['out']:>10,}  {s['out'] / grand:6.1%}  ({s['runs']} run(s))")

    main_share = by_role["main"]["out"] / grand
    print(f"\nMain session wrote {main_share:.0%} of all output tokens in this scope.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--sessions", type=int, default=1)
    args = ap.parse_args()

    d = transcript_dir()
    paths = sorted(glob.glob(os.path.join(d, "*.jsonl")), key=os.path.getmtime, reverse=True)
    if not paths:
        print(f"No transcripts under {d}", file=sys.stderr)
        return 1
    return report(paths if args.all else paths[: args.sessions])


if __name__ == "__main__":
    sys.exit(main())
