#!/usr/bin/env python3
"""PreToolUse guard that makes role boundaries real instead of prompt etiquette.

Registered in .claude/settings.json for Write|Edit|NotebookEdit. Every hook payload
carries `agent_type`, so one script can police both the main session and each
subagent:

  main session  -> writing production code or a tracking record is the exact leak
                   that turns this project into a single Opus session. Escalate to
                   the user (ask) instead of letting it happen silently.
  architect     -> specs and tests only; never production code.
  builder       -> production code only; tests and docs belong to other roles.
  scribe        -> docs/agent/ only.
  scout         -> read-only.

Unknown agent types are not policed: this guard owns the routing roles, not every
agent that may run in the repo.

Env overrides:
  ROUTING_GUARD=off   disable entirely
  ROUTING_MAIN=deny|ask|off   main-session severity (default ask)
"""
import json
import os
import re
import sys

MAIN_ALIASES = {"", "main", "default", "root", "none"}
RECORDS = {
    "TASK.md", "TASK_ARCHIVE.md", "PROGRESS.md", "PROGRESS_ARCHIVE.md",
    "BUG_FIX.md", "FIXED_BUG.md", "CHANGELOG.md",
}
TEST_RE = re.compile(r"\.(test|spec)\.[tj]sx?$")

# role -> {path class: decision}. "*" applies to every class.
RULES = {
    "main": {"prod": "@main", "record": "@main"},
    "architect": {"prod": "deny"},
    "builder": {"test": "deny", "doc": "deny", "record": "deny", "spec": "deny"},
    "scribe": {"prod": "deny", "test": "deny", "spec": "deny", "config": "deny"},
    "scout": {"*": "deny"},
    "reviewer": {"*": "deny"},
}

REASONS = {
    ("main", "prod"): (
        "Main session is editing production code. That is Opus-priced implementation: "
        "dispatch `builder` with a spec path (see the `route` skill), or confirm this is "
        "a Lane 0 edit small enough that a dispatch would cost more than the edit."
    ),
    ("main", "record"): (
        "Main session is editing a tracking record. Bookkeeping is mechanical work at the "
        "most expensive rate in the system: dispatch `scribe` with the facts, or confirm "
        "this edit is too small to hand off."
    ),
    ("architect", "prod"): (
        "Architect writes specs and tests, never production code. Encode the requirement "
        "as a failing test and let builder implement it."
    ),
    ("builder", "test"): (
        "Builder may not change test files. Tests are the architect's output; a test that "
        "looks wrong is a spec conflict to report, not to edit."
    ),
    ("builder", "doc"): "Builder writes production code only. Records belong to scribe.",
    ("builder", "record"): "Builder writes production code only. Records belong to scribe.",
    ("builder", "spec"): "Builder implements the spec; it does not amend it. Report the conflict.",
}


def classify(path: str, project: str) -> str:
    try:
        rel = os.path.relpath(os.path.abspath(path), project)
    except ValueError:
        return "other"
    if rel.startswith(".."):
        return "outside"
    parts = rel.split(os.sep)
    if rel.startswith("docs/agent/specs/"):
        return "spec"
    if len(parts) == 3 and rel.startswith("docs/agent/") and parts[2] in RECORDS:
        return "record"
    if rel.startswith("docs/"):
        return "doc"
    if TEST_RE.search(rel) or "/tests/" in rel or "/e2e/" in rel:
        return "test"
    if rel.startswith("sources/"):
        return "prod"
    if rel.startswith(".claude/"):
        return "config"
    return "other"


def respond(decision: str, reason: str) -> None:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main() -> None:
    if os.environ.get("ROUTING_GUARD", "").lower() == "off":
        sys.exit(0)
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never break the session on a malformed payload

    role = (payload.get("agent_type") or "").strip()
    role = "main" if role.lower() in MAIN_ALIASES else role
    rules = RULES.get(role)
    if not rules:
        sys.exit(0)

    target = (payload.get("tool_input") or {}).get("file_path")
    if not target:
        sys.exit(0)

    project = os.path.abspath(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    cls = classify(target, project)
    decision = rules.get(cls) or rules.get("*")
    if not decision:
        sys.exit(0)

    if decision == "@main":
        level = os.environ.get("ROUTING_MAIN", "ask").lower()
        if level == "off":
            sys.exit(0)
        decision = "deny" if level == "deny" else "ask"

    reason = REASONS.get((role, cls))
    if not reason:
        reason = f"Role `{role}` may not write {cls} files. See CLAUDE.md - Task routing."
    respond(decision, f"[routing/{role}] {reason}")


if __name__ == "__main__":
    main()
