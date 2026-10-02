#!/bin/bash
# Tests of the server-side pieces of the deploy kit (gate + root wrapper), with their test hooks, as a NON-root user.
# Run inside any Linux (see run-tests-in-docker.sh). No network, no application, no production.
set -uo pipefail
KIT=$(cd "$(dirname "$0")/.." && pwd)
GATE=$KIT/server/2j-deploy-gate
RUN=$KIT/server/2j-deploy-run
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "PASS  $1"; }
ko() { fail=$((fail+1)); echo "FAIL  $1  ${2:-}"; }
expect_code() { # name expected_code actual_code
  if [[ "$2" == "$3" ]]; then ok "$1"; else ko "$1" "(expected exit $2, got $3)"; fi
}
SHORT=abc1234; RB=def5678; ID=0123456789abcdef0123456789abcdef
REL="2jfitness-code-$SHORT-$ID.tar.gz"; RBK="2jfitness-code-$SHORT-rollback-$RB-$ID.tar.gz"; RN="deploy-$SHORT-$ID.sh"

gate() { # run the gate with a command, inputs from stdin
  GATE_INCOMING=$T/in GATE_RUN_CMD="echo RUN-CALLED" SSH_ORIGINAL_COMMAND="$1" bash "$GATE"
}

echo "== gate =="
out=$(gate "ping" 2>&1); expect_code "ping answers" 0 $?; [[ "$out" == gate=ok* ]] && ok "ping output" || ko "ping output" "$out"
for bad in "" "id" "bash" "sudo -n true" "cat /etc/passwd" "ping extra" "put" "put ../x" "put a/b" "put evil.sh" "put deploy-abc1234.sh" "run" "run a b c" "run abc1234 def5678" "ls; id" '$(id)' "put 2jfitness-code-abc1234-0123.tar.gz"; do
  out=$(gate "$bad" </dev/null 2>&1); c=$?
  [[ $c -eq 126 ]] && ok "refused: '${bad}'" || ko "refused: '${bad}'" "(exit $c: $out)"
done
out=$(echo "payload" | gate "put $REL" 2>&1); expect_code "put accepts a release archive name" 0 $?
[[ -f $T/in/$REL && "$(cat $T/in/$REL)" == "payload" ]] && ok "put stored the file" || ko "put stored the file"
echo "x" | gate "put $RBK" >/dev/null 2>&1; expect_code "put accepts the rollback archive name" 0 $?
echo "x" | gate "put $RN" >/dev/null 2>&1; expect_code "put accepts the runner name" 0 $?
out=$(gate "put $REL" </dev/null 2>&1); expect_code "put refuses an empty upload" 126 $?
head -c 2000 /dev/zero | GATE_MAX_BYTES=1000 GATE_INCOMING=$T/in SSH_ORIGINAL_COMMAND="put $REL" bash "$GATE" >/dev/null 2>&1; expect_code "put refuses an oversized upload" 126 $?
[[ "$(cat $T/in/$REL)" == "payload" ]] && ok "a refused upload leaves the previous file intact" || ko "a refused upload leaves the previous file intact"
ls $T/in/.part.* >/dev/null 2>&1 && ko "no partial files left behind" || ok "no partial files left behind"
out=$(gate "run $SHORT $RB $ID" 2>&1); [[ "$out" == "RUN-CALLED $SHORT $RB $ID" ]] && ok "run forwards exactly the validated arguments" || ko "run forwards" "$out"

echo "== root wrapper (as non-root test mode) =="
mkdir -p $T/inc $T/bk
export RUN_INCOMING=$T/inc RUN_BACKUPS=$T/bk RUN_AUDIT=$T/audit.log RUN_LOCK=$T/lock RUN_OWNER=$(id -un)
w() { bash "$RUN" "$@" 2>&1; }
out=$(w); expect_code "no arguments refused" 2 $?
out=$(w abc12 def5678 $ID); expect_code "short hash too short refused" 2 $?
out=$(w abc1234 def5678 nothex); expect_code "bad run id refused" 2 $?
out=$(w '../../etc' def5678 $ID); expect_code "path-like argument refused" 2 $?
out=$(w $SHORT $RB $ID); expect_code "missing files refused" 3 $?
echo "tar" >$T/inc/$REL; echo "rb" >$T/inc/$RBK
out=$(w $SHORT $RB $ID); expect_code "a missing runner refused" 3 $?
printf '#!/bin/bash\necho "RUNNER-RAN args=$#"\nexit 0\n' >$T/inc/$RN
ln -s /etc/passwd $T/inc/link.tar; mv $T/inc/$REL $T/inc/$REL.keep; ln -s /etc/passwd $T/inc/$REL
out=$(w $SHORT $RB $ID); expect_code "a symlink in place of a file refused" 3 $?
rm $T/inc/$REL; mv $T/inc/$REL.keep $T/inc/$REL
: >$T/inc/$RBK
out=$(w $SHORT $RB $ID); expect_code "an empty file refused" 3 $?
echo "rb" >$T/inc/$RBK

out=$(w $SHORT $RB $ID); c=$?
expect_code "a complete upload runs the runner" 0 $c
[[ "$out" == *"RUNNER-RAN args=0"* ]] && ok "runner executed" || ko "runner executed" "$out"
for f in $REL $RBK $RN; do [[ -f $T/bk/$f ]] && ok "installed into backups: $f" || ko "installed into backups: $f"; done
for f in $REL $RBK $RN; do [[ ! -e $T/inc/$f ]] && ok "removed from incoming: $f" || ko "removed from incoming: $f"; done
grep -q "START" $T/audit.log && grep -q "END(exit=0)" $T/audit.log && ok "audit trail written (START and END)" || ko "audit trail" "$(cat $T/audit.log)"

# the runner's exit code passes through (a failed deploy must fail the local runner)
echo "tar" >$T/inc/$REL; echo "rb" >$T/inc/$RBK; printf '#!/bin/bash\necho FAILING\nexit 7\n' >$T/inc/$RN
out=$(w $SHORT $RB $ID); expect_code "runner failure is propagated" 7 $?
grep -q "END(exit=7)" $T/audit.log && ok "failure audited" || ko "failure audited"

# two deployments can never overlap
echo "tar" >$T/inc/$REL; echo "rb" >$T/inc/$RBK; printf '#!/bin/bash\nsleep 3\n' >$T/inc/$RN
( w $SHORT $RB $ID >/dev/null & ) ; sleep 1
ID2=fedcba9876543210fedcba9876543210
for f in "2jfitness-code-$SHORT-$ID2.tar.gz" "2jfitness-code-$SHORT-rollback-$RB-$ID2.tar.gz" "deploy-$SHORT-$ID2.sh"; do echo x >$T/inc/$f; done
out=$(w $SHORT $RB $ID2); expect_code "a concurrent deployment is refused" 4 $?
sleep 3

echo "== summary: $pass passed, $fail failed =="
[[ $fail -eq 0 ]]
