# Codex Project Notes

## Station PC Update Rule

When a code or documentation change is intended to be pulled onto the station PC:

1. Run the relevant checks for the change.
2. Stage, commit, and push the change to `origin/main`.
3. Confirm `git status --short` is clean.
4. Only then give the station PC update commands.

Use `git pull --ff-only` in station PC instructions. If it fails, stop and review
the station PC's local changes instead of forcing, rebasing, or resetting.

Include `npm run build:mobile` in station PC update commands before restarting
the dev stack. The ngrok/backend mobile URL serves `/mobile` from `mobile/dist`,
so mobile UI changes are not visible there until the mobile bundle is rebuilt.
