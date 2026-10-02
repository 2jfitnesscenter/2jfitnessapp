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
# sshd runs a forced command through the account's login shell, so the shell must be a real one (never nologin/false). A human
# still gets no shell: authorized_keys forces the gate with `restrict` (no pty) and the password is unusable.
# The password field is '*' (matches no password) instead of a '!' lock: some UsePAM setups refuse '!'-locked accounts even for
# public-key logins (defensive; it was not the cause of the first failed bootstrap — that was a passphrase on the local key).
usermod --shell /bin/bash --password '*' --expiredate '' --inactive -1 "$U"
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

# upload area (the only thing the user owns) and a root-owned .ssh. sshd StrictModes: home must not be group/world-writable.
chown "$U:$U" "$home"; chmod 0750 "$home"
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

echo "== account state (must allow public-key login) =="
echo "passwd: $(getent passwd "$U")"
echo "shadow password field: [$(getent shadow "$U" | cut -d: -f2 | cut -c1-3)]"
chage -l "$U" 2>/dev/null | sed 's/^/chage:  /' || true
stat -c 'modes:  %n %U:%G %a' "$home" "$home/.ssh" "$home/.ssh/authorized_keys"
[[ -e /etc/nologin ]] && echo "WARNING: /etc/nologin exists (blocks non-root logins)"
shell=$(getent passwd "$U" | cut -d: -f7)
case "$shell" in */nologin|*/false|"") echo "ERROR: unusable login shell: $shell" >&2; exit 1;; esac
grep -qx "$shell" /etc/shells || echo "WARNING: $shell is not listed in /etc/shells"
if command -v sshd >/dev/null 2>&1; then
  echo "sshd effective policy for $U:"
  sshd -T -C "user=$U,host=localhost,addr=127.0.0.1" 2>/dev/null | grep -Ei '^(pubkeyauthentication|usepam|allowusers|allowgroups|denyusers|denygroups|authorizedkeysfile|strictmodes|authenticationmethods) ' | sed 's/^/  /' || true
fi

echo "== installed =="
id "$U"
echo "groups: $(id -nG "$U")"
sudo -l -U "$U" 2>/dev/null | sed -n '/may run/,$p' | head -8 || true
echo "authorized_keys: $(stat -c '%U:%G %a' "$home/.ssh/authorized_keys")  incoming: $(stat -c '%U:%G %a' "$home/incoming")"
echo "host_ed25519_fingerprint: $(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | cut -d' ' -f2)"
echo "INSTALL_OK"
