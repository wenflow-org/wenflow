# Security Policy

## Secret Handling

- Never commit real credentials, populated `.env` files, SQLite databases, database backups, logs, or heap dumps.
- Example files must contain obvious placeholders such as `replace-with-your-key`.
- Database API keys and MCP credentials use the versioned AES-256-GCM envelope documented in `DEPLOYMENT.md`.
- Keep `SECRET_ENCRYPTION_KEYS` outside the database and include it in encrypted operational backups.

Run both scans before publishing changes:

```powershell
npm run security:scan:current
npm run security:scan:history
```

The history baseline contains SHA-256 fingerprints only. It does not make an exposed credential safe and must not be used to allow new occurrences in the current tree.

## Credential Exposure Response

1. Revoke or rotate the credential at the provider before changing repository files.
2. Review provider usage logs, source IPs, billing, and suspicious calls.
3. Replace the current-tree value with an obvious placeholder.
4. Record only a one-way fingerprint when a non-rewritten historical baseline is required.
5. Scan the current tree and all reachable Git refs again.
6. Do not test a suspected leaked credential by sending a live API request from a developer machine.

Known historical credential fingerprints requiring provider-side revocation and verification:

- `fcbc76263741`
- `b940ad0f5a28`

## Database Backups

- Store backups outside the Git worktree in an access-controlled backup directory.
- Preserve the matching Secret encryption Keyring separately; encrypted database values cannot be restored without it.
- On Windows, restrict backup access to the service account and designated administrators with `icacls`.
- On Linux, use a dedicated owner and permissions no broader than `0600` for files and `0700` for directories.
- Test restoration against isolated copies before deployment.
- Never use a production backup as an automated test fixture.
- Use `npm run database:backup:create -- --confirm-quiesced --output <absolute-directory>` instead of copying a live `.db` file. The command uses SQLite Online Backup and includes committed WAL data.
- Verify every backup in isolation with `npm run database:backup:verify -- <backup-set-directory>`.
- A backup manifest stores only Keyring SHA-256 fingerprints. It never exports the Keyring, so the actual Keyring must remain in a separate encrypted backup.
- The two SQLite files are individually consistent but not a cross-database atomic snapshot. Stop writes before confirming `--confirm-quiesced`.

Audit sensitive runtime paths with `npm run permissions:audit`. Repair is never automatic; after saving the existing ACL and confirming `WENFLOW_SERVICE_ACCOUNT`, run `npm run permissions:repair` explicitly.

The local MCP filesystem tool resolves configured roots and requested files through `realpath`, enforces path-component boundaries, rejects symlink or junction escapes and non-regular files, and applies a byte-size limit before returning content.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing credentials, user data, database extracts, or exploitable details.
