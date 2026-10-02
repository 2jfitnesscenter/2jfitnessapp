#!/bin/bash
# Runs the kit's server-side tests in a throwaway Ubuntu container: (1) the gate and wrapper tests as an unprivileged user, and
# (2) install-on-server.sh as root in a clean system, twice (idempotence), checking users, ownership, sudoers and the forced command.
# Needs Docker and network access for apt inside the container. Touches nothing outside the container.
set -euo pipefail
KIT=$(cd "$(dirname "$0")/.." && pwd)
MSYS_NO_PATHCONV=1 docker run --rm -v "$KIT:/kit:ro" ubuntu:24.04 bash -c '
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq sudo openssh-client util-linux >/dev/null
echo "##### 1) gate + wrapper tests (unprivileged user)"
useradd -m tester
su tester -c "cp -r /kit /home/tester/kit && bash /home/tester/kit/tests/test-deploy-kit.sh"
echo; echo "##### 2) server installer in a clean system"
mkdir -p /etc/ssh; ssh-keygen -q -t ed25519 -N "" -f /etc/ssh/ssh_host_ed25519_key
ssh-keygen -q -t ed25519 -N "" -f /tmp/k -C test-deploy
export PUBKEY="$(cat /tmp/k.pub)"
export GATE_B64="$(base64 -w0 /kit/server/2j-deploy-gate)" RUN_B64="$(base64 -w0 /kit/server/2j-deploy-run)"
bash /kit/server/install-on-server.sh | tail -12
echo "--- second run (idempotent):"; bash /kit/server/install-on-server.sh | tail -2
echo "--- checks"
u=deploy2j
test "$(stat -c %U:%a /usr/local/sbin/2j-deploy-gate)" = "root:755" && echo "PASS gate root-owned 755"
test "$(stat -c %U:%a /usr/local/sbin/2j-deploy-run)" = "root:755" && echo "PASS wrapper root-owned 755"
test "$(stat -c %U:%a /home/$u/.ssh)" = "root:755" && echo "PASS .ssh root-owned (user cannot edit its own restrictions)"
test "$(stat -c %U:%a /home/$u/.ssh/authorized_keys)" = "root:644" && echo "PASS authorized_keys root-owned 644"
grep -q "^restrict,command=\"/usr/local/sbin/2j-deploy-gate\" ssh-ed25519 " /home/$u/.ssh/authorized_keys && echo "PASS authorized_keys is restricted + forced command"
test "$(wc -l < /home/$u/.ssh/authorized_keys)" = "1" && echo "PASS exactly one key"
test "$(stat -c %U:%a /home/$u/incoming)" = "$u:700" && echo "PASS incoming owned by the user, 700"
test "$(id -nG $u)" = "$u" && echo "PASS user has no extra groups (not in docker/sudo/adm): $(id -nG $u)"
passwd -S $u | grep -q " L " && echo "PASS password locked"
visudo -c >/dev/null && echo "PASS sudoers valid"
sudo -l -U $u | sed -n "/may run/,\$p" | grep -v "^$"
test "$(sudo -l -U $u | grep -c NOPASSWD)" = "1" && echo "PASS exactly one NOPASSWD rule"
out=$(su $u -c "sudo -n /usr/bin/id" 2>&1 || true); echo "$out" | grep -qEi "password is required|not allowed|may not run" && echo "PASS the user cannot sudo anything else"
out=$(su $u -c "sudo -n /usr/local/sbin/2j-deploy-run abc1234 def5678 0123456789abcdef0123456789abcdef" 2>&1 || true); echo "$out" | grep -q "missing or not a regular file" && echo "PASS the user CAN run the wrapper (which refuses without uploaded files)"
out=$(su $u -c "SSH_ORIGINAL_COMMAND=id /usr/local/sbin/2j-deploy-gate" 2>&1 || true); echo "$out" | grep -q "refused" && echo "PASS the forced command refuses everything but ping/put/run"
echo ALL_DONE
'
