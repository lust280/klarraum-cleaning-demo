# Operations

## Backup and recovery

The application deletes active inquiries older than `RETENTION_DAYS` at startup and every minute. Sessions expire after eight hours. Completed requests are not automatically exempted from retention.

Run `npm run backup` in the service environment (same `DATA_DIR`). `BACKUP_DIR` defaults to a `backups` subdirectory inside `DATA_DIR`; on a persistent host set it to an appropriate protected directory. The command uses SQLite `VACUUM INTO` for a consistent standalone database snapshot with a matching `.sqlite.media` directory of uploaded images, sets file mode 0600 and prunes matching backup files older than `BACKUP_RETENTION_DAYS` (default seven days).

**A command alone is not an automatic/off-site backup system.** Arrange a daily job or managed backup service and copy snapshots to protected, encrypted storage outside the application's disk. Backups contain personal data and password-protected session metadata. Limit access, choose a suitable retention period and document it in the privacy notice. Check disk capacity and backup job failures. Do not place backups under `public/` or in Git.

To restore:

1. Stop the server. Keep a recoverable copy of the current database and its WAL/SHM files.
2. Test the snapshot separately with a private staging instance; disable live inquiry collection and real mail while inspecting it.
3. With the server stopped, replace `DATA_DIR/klarraum.sqlite` with the selected snapshot, and restore the contents of its matching `.sqlite.media` directory into `DATA_DIR/uploads`. Preserve the previous uploads directory first. Keep database and images from the same backup together. Remove stale WAL/SHM files only after preserving the existing database files. Keep the new database in a directory accessible only to the application user.
4. Rotate `APP_SECRET` to invalidate restored sessions. Start, check `/healthz`, log in and verify records. Do not overwrite production with a staging database accidentally.
5. Review pending mail state before enabling email retries. Restored notifications may already have been delivered after the snapshot; provider idempotency is time-limited.

The automated suite verifies snapshot readability, record restoration and retention on temporary databases. The actual host's persistence and off-site recovery still require acceptance testing.

## Security and support

- Production requires HTTPS, a password hash and a separate random application secret. No default password. Change the password via `npm run admin:hash` and the hosting secret setting, then restart. Changing credentials/secret invalidates sessions.
- Never expose the Node origin around a trusted proxy when `TRUST_PROXY=1`.
- Rate limiting is in process memory, resets on restart, and assumes one instance. This is suitable for a small single-company installation, not distributed abuse protection. A host-level firewall/challenge service can be added if abuse requires it.
- Monitor `/healthz` through the host or an external service. It checks application/DB availability, not actual mailbox delivery. Failed notification state is visible in the dashboard. Configure health alerts and test them before offering a support promise.
- Review updates for Node, the app and development tools. Password hashing/login limits reduce common risks; this is not a professional security audit or a guarantee against all attacks.
- SQL queries use bound parameters; admin renders customer text via `textContent`. Only authenticated image uploads are supported: JPG, PNG and WebP, max 5 MB and 12 megapixels; raster images are re-encoded as WebP without original metadata. SVG, animated formats and other attachments are rejected.
- Application logs do not intentionally print inquiry payloads or credentials. Review host access-log behavior separately.

## Updating

Back up first, push reviewed changes to `main`, run tests, and redeploy the Node service. Verify the health check and an authorized inquiry. The initial schema is created additively at startup; future schema changes need explicit reviewed migrations.

`npm run deploy` updates only the static GitHub Pages preview. It does not deploy the Node backend or activate live inquiry collection.
