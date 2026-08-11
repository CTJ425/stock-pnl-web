#!/usr/bin/env bash
# Verifies the routing hooks decide correctly. Run from the repo root:
#   bash .claude/hooks/test_hooks.sh
set -uo pipefail

export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
GUARD="$CLAUDE_PROJECT_DIR/.claude/hooks/routing_guard.py"
OBSERVE="$CLAUDE_PROJECT_DIR/.claude/hooks/routing_observe.py"
pass=0; fail=0

# expect <label> <expected: allow|ask|deny> <agent_type> <relative path> [env assignments...]
expect() {
  local label="$1" want="$2" agent="$3" path="$4"; shift 4
  local payload out got
  payload=$(python3 -c '
import json,sys
print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"Edit","agent_type":sys.argv[1],
                  "tool_input":{"file_path":sys.argv[2]}}))' "$agent" "$CLAUDE_PROJECT_DIR/$path")
  out=$(printf '%s' "$payload" | env "$@" python3 "$GUARD")
  if [[ -z "$out" ]]; then
    got="allow"
  else
    got=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecision"])')
  fi
  if [[ "$got" == "$want" ]]; then
    pass=$((pass+1)); printf '  ok   %-46s %s\n' "$label" "$got"
  else
    fail=$((fail+1)); printf '  FAIL %-46s want=%s got=%s\n' "$label" "$want" "$got"
  fi
}

echo "routing_guard.py"
expect "main edits production code"        ask   ""          sources/src/App.tsx
expect "main edits a tracking record"      ask   ""          docs/agent/PROGRESS.md
expect "main writes a spec"                allow ""          docs/agent/specs/task-77.md
expect "main edits its own config"         allow ""          .claude/settings.json
expect "architect writes production code"  deny  architect   sources/src/App.tsx
expect "architect writes a test"           allow architect   sources/src/App.test.tsx
expect "architect writes a spec"           allow architect   docs/agent/specs/task-77.md
expect "builder edits a test"              deny  builder     sources/src/services/warmStock.test.ts
expect "builder edits production code"     allow builder     sources/src/services/warmStock.ts
expect "builder edits a record"            deny  builder     docs/agent/TASK.md
expect "scribe edits a record"             allow scribe      docs/agent/TASK.md
expect "scribe edits production code"      deny  scribe      sources/src/App.tsx
expect "scout writes anything"             deny  scout       docs/agent/TASK.md
expect "reviewer writes anything"          deny  reviewer    sources/src/App.tsx
expect "unpoliced agent is left alone"     allow general-purpose sources/src/App.tsx
expect "ROUTING_MAIN=off releases main"    allow ""          sources/src/App.tsx  ROUTING_MAIN=off
expect "ROUTING_MAIN=deny hardens main"    deny  ""          sources/src/App.tsx  ROUTING_MAIN=deny
expect "ROUTING_GUARD=off disables all"    allow scout       sources/src/App.tsx  ROUTING_GUARD=off

echo "routing_observe.py"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
obs() { printf '%s' "$1" | CLAUDE_PROJECT_DIR="$tmp" python3 "$OBSERVE"; }
for i in $(seq 1 11); do
  obs '{"hook_event_name":"PostToolUse","tool_name":"Read","agent_type":"","session_id":"t1"}' >/dev/null
done
nudge=$(obs '{"hook_event_name":"PostToolUse","tool_name":"Read","agent_type":"","session_id":"t1"}')
if [[ "$nudge" == *"discovery calls"* ]]; then
  pass=$((pass+1)); printf '  ok   %-46s nudged at 12\n' "main-session discovery nudge"
else
  fail=$((fail+1)); printf '  FAIL %-46s no nudge at 12\n' "main-session discovery nudge"
fi
quiet=$(obs '{"hook_event_name":"PostToolUse","tool_name":"Read","agent_type":"scout","session_id":"t2"}')
if [[ -z "$quiet" ]]; then
  pass=$((pass+1)); printf '  ok   %-46s silent\n' "subagent discovery is not nudged"
else
  fail=$((fail+1)); printf '  FAIL %-46s nudged a subagent\n' "subagent discovery is not nudged"
fi
obs '{"hook_event_name":"SubagentStart","agent_type":"builder","agent_id":"a1","session_id":"t3","effort":{"level":"medium"}}' >/dev/null
if grep -q '"agent_type": "builder"' "$tmp/.claude/routing/dispatch.jsonl" 2>/dev/null; then
  pass=$((pass+1)); printf '  ok   %-46s logged\n' "SubagentStart is recorded"
else
  fail=$((fail+1)); printf '  FAIL %-46s not logged\n' "SubagentStart is recorded"
fi

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
