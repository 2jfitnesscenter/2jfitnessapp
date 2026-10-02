#!/bin/bash
# 2J Fitness — one-time, idempotent server setup of the restricted deploy user. Run AS ROOT, once, through the bootstrap script
# (windows/bootstrap-2j-deploy.ps1 pipes this file over a single SSH connection; GATE_B64, RUN_B64 and PUBKEY come in the environment).
#
# What it creates — and nothing else (no application file, no data/, no .env, no docker config, no sshd_config is touched):
#   user      deploy2j        locked password, no docker/sudo group, home /home/deploy2j
#   scripts   /usr/local/sbin/2j-deploy-gate   forced command of the deploy key (ping / put / run only)
#             /usr/local/sbin/2j-deploy-run    the single thing sudo lets deploy2j run, as root
#   sudoers   /etc/sudoers.d/2j-deploy         deploy2j → NOPASSWD only for 2j-deploy-run
#   ssh key   /home/deploy2j/.ssh/authorized_keys (owned by ROOT, so the user cannot edit its own restrictions):
#             restrict,command="…2j-deploy-gate" <public key>
#   audit     /var/log/2j-deploy-audit.log
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo "must run as root" >&2; exit 1; }
: "${GATE_B64:?}" "${RUN_B64:?}" "${PUBKEY:?}"
[[ "$PUBKEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9@._-]+)?$ ]] || { echo "unexpected public key format" >&2; exit 1; }

U=deploy2j
if ! id "$U" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "2J Fitness deploy (restricted)" "$U"
fi
passwd -l "$U" >/dev/null
home=$(getent passwd "$U" | cut -d: -f6)
[[ "$home" == /home/deploy2j ]] || { echo "unexpected home: $home" >&2; exit 1; }

# the two scripts (root-owned, not writable by anyone else)
printf '%s' "$GATE_B64" | base64 -d >/usr/local/sbin/2j-deploy-gate.new
printf '%s' "$RUN_B64" | base64 -d >/usr/local/sbin/2j-deploy-run.new
chmod 0755 /usr/local/sbin/2j-deploy-gate.new /usr/local/sbin/2j-deploy-run.new
chown root:root /usr/local/sbin/2j-deploy-gate.new /usr/local/sbin/2j-deploy-run.new
bash -n /usr/local/sbin/2j-deploy-gate.new && bash -n /usr/local/sbin/2j-deploy-run.new
mv -f /usr/local/sbin/2j-deploy-gate.new /usr/local/sbin/2j-deploy-gate
mv -f /usr/local/sbin/2j-deploy-run.new /usr/local/sbin/2j-deploy-run

# upload area (the only thing the user owns) and a root-owned .ssh
install -d -m 0700 -o "$U" -g "$U" "$home/incoming"
install -d -m 0755 -o root -g root "$home/.ssh"
printf 'restrict,command="/usr/local/sbin/2j-deploy-gate" %s\n' "$PUBKEY" >"$home/.ssh/authorized_keys.new"
chmod 0644 "$home/.ssh/authorized_keys.new"; chown root:root "$home/.ssh/authorized_keys.new"
mv -f "$home/.ssh/authorized_keys.new" "$home/.ssh/authorized_keys"

# sudo: exactly one command, validated before it is installed
tmp=$(mktemp)
cat >"$tmp" <<'SUDOERS'
# 2J Fitness deploy user: may run the deployment wrapper as root, nothing else.
Defaults:deploy2j !requiretty, env_reset
deploy2j ALL=(root) NOPASSWD: /usr/local/sbin/2j-deploy-run *
SUDOERS
visudo -cf "$tmp" >/dev/null
install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/2j-deploy
rm -f "$tmp"

touch /var/log/2j-deploy-audit.log; chmod 0640 /var/log/2j-deploy-audit.log; chown root:adm /var/log/2j-deploy-audit.log 2>/dev/null || true
mkdir -p /root/backups

echo "== installed =="
id "$U"
echo "groups: $(id -nG "$U")"
sudo -l -U "$U" 2>/dev/null | sed -n '/may run/,$p' | head -8 || true
echo "authorized_keys: $(stat -c '%U:%G %a' "$home/.ssh/authorized_keys")  incoming: $(stat -c '%U:%G %a' "$home/incoming")"
echo "host_ed25519_fingerprint: $(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | cut -d' ' -f2)"
echo "INSTALL_OK"
