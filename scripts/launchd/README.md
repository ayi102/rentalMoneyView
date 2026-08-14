# Scheduled backups (macOS launchd)

Supabase's free plan has **no automated backups** — their docs tell free-tier
projects to export and keep off-site copies. This runs `db:backup` daily so that
happens without you remembering.

Backups land next to your spreadsheets in Google Drive (a sibling of
`$RENTAL_XLSX_DIR`), so they're synced off the machine. 30 are kept; older ones are
pruned.

## Install

```bash
cp scripts/launchd/com.rentalmoneyview.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rentalmoneyview.backup.plist
```

That's it. It runs daily at **12:30 local time**.

If the Mac is asleep at 12:30, launchd runs the missed job when it next wakes — a
closed laptop delays a backup, it doesn't skip it.

## Verify

Run it immediately rather than waiting a day:

```bash
launchctl kickstart -k gui/$(id -u)/com.rentalmoneyview.backup
tail -20 data/backup.log
```

You want to see `--- ok ---` and a new file in the backups folder.

Confirm it's registered:

```bash
launchctl list | grep rentalmoneyview
```

## Check a backup is actually restorable

A backup you've never tested isn't a backup. This validates one without touching
the database:

```bash
npx tsx scripts/load-data.ts "<path to a backup .json>" --dry-run
```

It checks dates parse, that no transaction or mileage row references a missing
property, and that the dump isn't empty. Exit code 1 if it wouldn't restore.

## Restore

```bash
npx tsx scripts/load-data.ts "<path to a backup .json>" --force
```

`--force` **deletes** the current contents first and replaces them. Without it, the
load refuses to touch a non-empty database.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.rentalmoneyview.backup.plist
rm ~/Library/LaunchAgents/com.rentalmoneyview.backup.plist
```

## Notes

- **The plist has absolute paths in it.** If you move or rename the repo, edit the
  paths in `~/Library/LaunchAgents/com.rentalmoneyview.backup.plist` and reload it.
  `scripts/backup-cron.sh` finds the repo from its own location, so only the plist
  needs updating.
- **launchd is not a shell.** It runs jobs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
  and none of your profile, which is why Homebrew's node at `/opt/homebrew/bin`
  isn't found by default. `backup-cron.sh` prepends that itself — this is the usual
  reason a launch agent looks installed but never does anything.
- **Logs** are at `data/backup.log` (timestamped, self-truncating at 1 MB) plus
  `data/launchd.{out,err}.log` for anything that fails before the wrapper starts.
  All git-ignored.
- **Phone edits are covered.** The job reads Supabase, not local state, so changes
  made from your phone are captured on the next run.
- **It only runs when the Mac is on.** If you go weeks without opening the laptop,
  no backup happens in that window. Worth running `npm run db:backup` by hand after
  a big editing session on your phone.
