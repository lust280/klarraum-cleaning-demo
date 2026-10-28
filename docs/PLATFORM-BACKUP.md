# Platform backups

Manual download from the director console is unchanged: open Platform backup, choose a 16-character password, and save the `.klrb` file somewhere that is not this server. The password is not stored.

## Daily copy on the server disk

Set these on the running platform service, then restart it:

```text
PLATFORM_BACKUP_SCHEDULE=daily
PLATFORM_BACKUP_PASSWORD=a private password of 16 or more characters
PLATFORM_BACKUP_DIR=/var/data/backups
```

About 15 seconds after start, and then once an hour, the service checks whether today's encrypted file already exists. If it does not, it pauses requests briefly, writes `klarraum-platform-YYYY-MM-DD.klrb`, and records `backup-status.json` in the same directory. The director status line then says a daily disk copy is on.

That file is still on the same disk as the live data. It is not an off-site backup. Confirm the Render disk is persistent before relying on it. The commented keys are in `render-platform-production.yaml`. A separate Render cron is not required for this disk copy.

The offline command refuses to run while the platform process is running, because the database marker is present:

```sh
node --env-file=.env.backup scripts/platform-backup.mjs --scheduled --data /var/data/director --dir /var/data/backups
```

Use that only after the service is stopped. Prefer the environment variables on the running service.

## External storage

Nothing is uploaded until all five variables are set:

```text
PLATFORM_BACKUP_S3_ENDPOINT
PLATFORM_BACKUP_S3_BUCKET
PLATFORM_BACKUP_S3_REGION
PLATFORM_BACKUP_S3_ACCESS_KEY_ID
PLATFORM_BACKUP_S3_SECRET_ACCESS_KEY
```

The endpoint is the S3-compatible origin without the bucket, for example `https://ACCOUNT.r2.cloudflarestorage.com`. The upload uses path-style `PUT /bucket/klarraum-platform-YYYY-MM-DD.klrb`.

If any of the five is missing, the status says external storage is incomplete and no upload is attempted. If they are all set and the upload fails, the disk file remains and the status says the upload failed. A successful upload is the only state reported as off-site.

Do not set these until the credentials exist. Leaving them unset is the honest state: external storage is not configured.
