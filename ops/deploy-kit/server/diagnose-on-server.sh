#!/bin/bash
# READ-ONLY diagnostic of why the deploy2j key is refused. Run as root. Changes nothing.
U=deploy2j
EXPECTED='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMpRljoAk7yoDOIkNGK2V56HgZSiFH8+s71jCb2O06NS'
echo "## 1 getent passwd";            getent passwd "$U"
echo "## shell listed in /etc/shells?"; grep -nx "$(getent passwd "$U" | cut -d: -f7)" /etc/shells || echo "NOT LISTED"
echo "## /etc/nologin";               ls -l /etc/nologin 2>&1
echo "## 2 account state";             passwd -S "$U"; echo "shadow field: [$(getent shadow "$U" | cut -d: -f2 | cut -c1-3)] (first 3 chars; '!' = locked)"; chage -l "$U"
echo "## 3 owners/modes";              stat -c '%n %U:%G %a' /home /home/"$U" /home/"$U"/.ssh /home/"$U"/.ssh/authorized_keys
echo "## 4 authorized_keys";           cat -A /home/"$U"/.ssh/authorized_keys
echo "## 8 key matches exactly?";      grep -qF "$EXPECTED" /home/"$U"/.ssh/authorized_keys && echo "KEY MATCHES" || echo "KEY DIFFERS"
echo "## 5 sshd effective config";     sshd -T -C "user=$U,host=localhost,addr=127.0.0.1" 2>&1 | grep -Ei '^(pubkeyauthentication|usepam|allowusers|allowgroups|denyusers|denygroups|authorizedkeysfile|strictmodes|authenticationmethods|passwordauthentication|permitrootlogin|loglevel) '
echo "## sshd_config.d";               ls -l /etc/ssh/sshd_config.d 2>&1; grep -rEin '^(AllowUsers|AllowGroups|DenyUsers|DenyGroups|Match)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null
echo "## PAM sshd account stack";      grep -vE '^\s*(#|$)' /etc/pam.d/sshd | grep -E '^account|pam_access|pam_nologin|pam_faillock|pam_listfile'
echo "## 6 sshd log for deploy2j";     { journalctl -u ssh -u sshd --no-pager -n 400 2>/dev/null || tail -n 400 /var/log/auth.log 2>/dev/null; } | grep -Ei "$U|fatal|refused|not allowed|locked|expired|pam_" | tail -n 40
echo "## sudoers";                     visudo -c 2>&1 | tail -n 3; cat /etc/sudoers.d/2j-deploy 2>&1
echo DIAG_DONE
