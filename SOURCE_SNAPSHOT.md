# Source snapshot

This portable tree was derived read-only from `/home/cbb/SERVER` on 2026-10-19.
The source Git commit was:

```text
12c3d099d8a64aacc93f484c9d8fe1605c00ce12
```

The snapshot intentionally included the current application working-tree edits
and the untracked `DisplaySettingsMenu.jsx`, then added portable deployment
files only in `GENOCULAR_DOWNLOADBLE`. It did not copy `.git`, `.env`, service
state, credentials, database dumps, generated assets, logs, caches, or backup
files. The source repository was not modified.

The 27 small synthetic demo objects (14 KiB total) were exported read-only from
the live `demo-results` bucket into `demo/fixtures/`, because those application
fixtures were not present in the source Git working tree. No user uploads,
analysis results, credentials, or mutable service data were copied.
