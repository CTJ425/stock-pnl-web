#!/usr/bin/env python3
"""Answers one question with evidence: did this session actually route, or did Opus do it all?

Reads the session transcripts Claude Code already writes and reports token volume per
model, split between the main thread and sidechains (subagent turns). A healthy routed
session shows most output tokens on the cheap models; an all-Opus session shows a single
model and zero sidechain traffic, which is the failure this whole setup exists to prevent.

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
    slug = PROJECT.replace("/", "-")
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", slug)


def read_session(path: str):
    """-> {(model, is_sidechain): {in, out, cache_read, turns}}"""
    stats = defaultdict(lambda: {"in": 0, "out": 0, "cache_read": 0, "turns": 0})
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            row = json.loads(line)
        except Exception:
            continue
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        usage = msg.get("usage")
        if not usage:
            continue
        key = (msg.get("model") or "unknown", bool(row.get("isSidechain")))
        s = stats[key]
        s["in"] += usage.get("input_tokens", 0)
        s["out"] += usage.get("output_tokens", 0)
        s["cache_read"] += usage.get("cache_read_input_tokens", 0)
        s["turns"] += 1
    return stats


def dispatch_counts():
    path = os.path.join(PROJECT, ".claude", "routing", "dispatch.jsonl")
    counts = defaultdict(int)
    if os.path.exists(path):
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("event") == "SubagentStart":
                counts[row.get("agent_type") or "?"] += 1
    return counts


def report(paths) -> int:
    total_out = defaultdict(int)
    for path in paths:
        stats = read_session(path)
        if not stats:
            continue
        print(f"\n=== {os.path.basename(path)[:8]}  ({os.path.getmtime(path):.0f})")
        print(f"{'model':<22}{'where':<11}{'turns':>7}{'out':>12}{'in':>12}{'cache_read':>14}")
        for (model, side), s in sorted(stats.items(), key=lambda kv: -kv[1]["out"]):
            where = "sidechain" if side else "main"
            print(f"{model:<22}{where:<11}{s['turns']:>7}{s['out']:>12,}{s['in']:>12,}{s['cache_read']:>14,}")
            total_out[model] += s["out"]

    if not total_out:
        print("No usage found in the selected transcripts.")
        return 1

    grand = sum(total_out.values())
    print("\n--- output tokens by model (the routing verdict) ---")
    for model, out in sorted(total_out.items(), key=lambda kv: -kv[1]):
        print(f"{model:<22}{out:>12,}  {out / grand:6.1%}")

    counts = dispatch_counts()
    print("\n--- dispatches recorded by routing_observe.py ---")
    print("  " + (", ".join(f"{k}={v}" for k, v in sorted(counts.items())) if counts else "none yet"))
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
