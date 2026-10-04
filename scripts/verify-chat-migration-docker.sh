#!/usr/bin/env bash
# Real-filesystem check of the chat.json AES migration inside the API image (POSIX ownership/modes are not testable on Windows hosts):
#   scripts/verify-chat-migration-docker.sh 2jfitness-api:<tag>
# 1. as root: a plaintext chat.json with an unusual owner/group/mode is converted, keeping owner, group and mode;
# 2. as root: a new chat.json is created 0600;
# 3. as an unprivileged user that cannot chown: the migration is aborted and the original stays byte-for-byte intact.
# Prints only metadata and yes/no flags - never chat content.
set -euo pipefail
IMAGE="${1:?usage: verify-chat-migration-docker.sh <image>}"
inside() { docker run --rm -i --entrypoint sh "$IMAGE" -s; }

echo "== 1. root, owner 1234:5678 mode 640, plaintext -> AES =="
out=$(inside <<'SH'
mkdir -p /tmp/d && printf 'a%.0s' $(seq 1 64) > /tmp/d/secret
echo '{"threads":[],"messages":[{"id":"m","threadId":"t","text":"PRIVATE-TEXT"}]}' > /tmp/d/chat.json
chmod 640 /tmp/d/chat.json; chown 1234:5678 /tmp/d/chat.json
before=$(stat -c '%u:%g:%a' /tmp/d/chat.json)
DATA_DIR=/tmp/d node --input-type=module -e 'await import("/app/chat/store.js")'
after=$(stat -c '%u:%g:%a' /tmp/d/chat.json)
head -c1 /tmp/d/chat.json | grep -q '{' && enc=no || enc=yes
grep -q PRIVATE-TEXT /tmp/d/chat.json && leak=yes || leak=no
echo "before=$before after=$after encrypted=$enc plaintext_on_disk=$leak"
SH
)
echo "$out"
[[ "$out" =~ before=([0-9:]+)\ after=([0-9:]+)\ encrypted=yes\ plaintext_on_disk=no ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]] || { echo "FAIL: metadata changed or not encrypted" >&2; exit 1; }

echo "== 2. root, new file =="
out=$(inside <<'SH'
mkdir -p /tmp/d && printf 'a%.0s' $(seq 1 64) > /tmp/d/secret
DATA_DIR=/tmp/d node --input-type=module -e 'const c = await import("/app/chat/store.js"); c.createThread("u1", "hola")'
echo "mode=$(stat -c '%a' /tmp/d/chat.json)"
SH
)
echo "$out"; [[ "$out" == *"mode=600"* ]] || { echo "FAIL: new chat.json is not 0600" >&2; exit 1; }

echo "== 3. unprivileged user cannot chown: migration aborted, original intact =="
out=$(inside <<'SH'
mkdir -p /tmp/d && printf 'a%.0s' $(seq 1 64) > /tmp/d/secret && chmod 644 /tmp/d/secret
echo '{"threads":[],"messages":[{"id":"m","threadId":"t","text":"PRIVATE-TEXT"}]}' > /tmp/d/chat.json
chmod 666 /tmp/d/chat.json; chown 1234:5678 /tmp/d/chat.json; chmod 777 /tmp/d
h1=$(sha256sum /tmp/d/chat.json | cut -d' ' -f1)
setpriv --reuid=1000 --regid=1000 --clear-groups env DATA_DIR=/tmp/d node --input-type=module -e 'await import("/app/chat/store.js")' 2>/dev/null || true
h2=$(sha256sum /tmp/d/chat.json | cut -d' ' -f1)
[ -e /tmp/d/chat.json.tmp ] && tmpleft=yes || tmpleft=no
[ "$h1" = "$h2" ] && same=yes || same=no
echo "original_intact=$same temp_left=$tmpleft"
SH
)
echo "$out"; [[ "$out" == *"original_intact=yes temp_left=no"* ]] || { echo "FAIL: aborted migration changed the original" >&2; exit 1; }
echo "OK: chat migration preserves owner/group/mode, creates 0600, and aborts safely"
