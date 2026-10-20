# Reference database distribution

The source installation currently uses approximately 562 GiB under `/data/dbs`.
The repository deliberately excludes it. `scripts/download_databases.sh`
supports a resumable Google Drive folder transfer and validates the result
against `config/required-databases.txt` before any analysis services start.

## Recommended: private Drive folder and service account

1. In a Google Cloud project, enable the Google Drive API and create a service
   account. Download its JSON key to the deployment machine as
   `secrets/google-drive-service-account.json`.

2. Share the database folder in Google Drive with the service account's email
   address as Viewer. The folder contents must be the contents of `dbs` itself:
   `adapters/`, `kraken2_db/`, `gtdbtk/`, and so on. Do not add another outer
   `dbs/` directory.

3. Copy and edit the local configuration:

   ```bash
   cp databases.env.example databases.env
   chmod 600 databases.env secrets/google-drive-service-account.json
   ```

   Set:

   ```dotenv
   DB_SOURCE=google-drive-folder
   GDRIVE_FOLDER_ID=the_folder_id_from_the_drive_url
   GDRIVE_SERVICE_ACCOUNT_JSON=./secrets/google-drive-service-account.json
   ```

4. Download/resume and validate:

   ```bash
   ./scripts/download_databases.sh
   ```

The downloader uses rclone in a container, performs retries, does not delete
existing destination files, and can be rerun after interruption. Google Drive
quotas still apply. Keep the service-account key outside the Drive folder and
never commit it.

## Public shared folder

For a smaller public folder, set `DB_SOURCE=google-drive-public-folder` and
`GDRIVE_PUBLIC_FOLDER_URL`. This uses `gdown`. For the full database tree, the
service-account/rclone method is more reliable and easier to resume.

## Existing database directory

Point Compose at an existing complete tree without copying it:

```bash
./Setup.sh --database-path /absolute/path/to/dbs --gpu
```

The directory remains managed by the operator and is mounted read-only in the
API and runner containers.

## Preparing the Drive folder

From a machine with a configured rclone Drive remote, upload the contents—not
the enclosing directory—and preserve filenames:

```bash
rclone copy /data/dbs your-drive-remote:genocular-databases \
  --progress --transfers 4 --checkers 8
```

After upload, test a clean download and run
`./scripts/validate_databases.sh`. If the workflow gains a new database, add a
stable marker file or directory to `config/required-databases.txt` in the same
commit as the workflow change.
