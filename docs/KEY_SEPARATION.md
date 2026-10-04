# Key separation — the secret no longer has to live in `./data`

The instance secret signs session cookies and derives (HKDF) every at-rest encryption key (`state-*.json`, `chat.json`, OAuth/AI credentials). It used to sit in `./data/secret`,
so any backup of `./data` carried the key to its own ciphertext. Now `SECRET_FILE` can point elsewhere (`api/lib/secret.js`, the only place the secret is located).
Nothing is re-encrypted: **the same key keeps decrypting the same files**, only its location changes. Without `SECRET_FILE` everything behaves exactly as before.

## Procedure (on the server, ~5 minutes, no downtime beyond one container restart)
1. `scripts/separate-secret.sh` — copies `data/secret` → `secrets/secret` (0700 dir, 0600 file, same owner as `data`), verifies identical, deletes nothing.
2. Add `SECRET_FILE=/secrets/secret` to `.env`; apply with `docker compose up -d` (a plain `restart` does not re-read `.env`). `docker-compose.yml` already mounts `${SECRETS_DIR:-./secrets}:/secrets`.
3. Check `/api/health`, one passkey login and one workout load. Sessions stay valid (same key).
4. `scripts/secret-export.sh` — prints the secret once; store it **offline** (password manager). This is the recovery copy.
5. `I_SAVED_AN_OFFLINE_COPY=yes scripts/separate-secret.sh --remove-legacy` — only now `data/secret` is removed. From here `./data` backups contain ciphertext only.

## Backups and recovery
- `./data` backups (`backup-data.sh`, off-site `backup-offsite.sh`, pre-deploy tarballs made after step 5) no longer contain the key. The off-site archive is additionally encrypted with its own passphrase.
- **Losing the server:** restore `./data` from backup + put the offline secret in `secrets/secret` (mode 0600, dir 0700, owner = API user) + set `SECRET_FILE`. Everything decrypts.
- **Losing the secret AND the offline copy:** state files, chat and stored OAuth/AI credentials are unrecoverable (that is the point of encryption); accounts/passkeys (`db.json`, plain) survive, members' devices still hold their own data and re-sync it. Keep the offline copy.
- Rotation is not offered (it needs re-encrypting every file); if the secret leaks, treat it as a new-instance migration decision.
- The Coach runtime user must not be able to read `/secrets` (keep it 0700 owned by the API user, like `data`).
- Pre-existing backups made before step 5 still contain the old copy of the key: delete or re-encrypt them when you no longer need them.
