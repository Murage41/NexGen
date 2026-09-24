# NexGen: rules for every session

NexGen is the owner's petrol station ERP (Kenya): shifts and pump readings,
cash/M-Pesa, customer credit and invoices, attendants' shortages, payroll,
stock and deliveries. It runs on the station PC (desktop app + backend) with a
phone web app for attendants and the owner, and is meant to become a
production ERP for other stations.

These files are the single source of truth. Every session, whatever tool or
worktree, follows them and keeps them current:

| File | What it holds |
|---|---|
| `docs/PROJECT-STATUS.md` | Current state, the station's version, pending station updates, open items |
| `docs/ROADMAP.md` | What is left to build, in order, with each item's spec |
| `docs/ENGINEERING-STANDARDS.md` | How to build, test and deploy (money rules, migrations, E2E, station updates) |
| `docs/*.md` (others) | How each feature works, written for the owner |

## Start of a session

1. Read `docs/PROJECT-STATUS.md`. Read only the `docs/ROADMAP.md` section for
   the item you are working on, and the standards section that matches the
   change.
2. Run `git status --short` and `git log --oneline -5`. If they don't match the
   status doc (uncommitted work, unknown commits), stop and reconcile with the
   owner before building on top. Another session may be working in this
   folder at the same time: never stage, revert or "clean up" files you
   didn't change, and commit with explicit paths, never `git add -A`.
3. Don't re-derive what these files record or re-litigate decisions they
   state. If you find them wrong, fix them and say so.

## End of a session (or whenever work lands)

- Update `docs/PROJECT-STATUS.md` (what shipped with its commit, the station's
  pending updates and the next update number, open items) and mark the item in
  `docs/ROADMAP.md`.
- Update the owner-facing doc for any behaviour change.
- A lesson or convention learned this session goes into
  `docs/ENGINEERING-STANDARDS.md` (or here, if it is about how sessions work),
  so the next session starts with it.
- Before committing, verify: tests, and the change working on both desktop
  and phone where it touches both.
- Commit and push **only when the owner asks**. Then give station update
  commands per `docs/ENGINEERING-STANDARDS.md` §7: one block per update, in
  order, each with its own check, written for Command Prompt.

## Working with the owner

- The owner runs a petrol station, not software. Write plain English: short
  sentences, no jargon, say what happens to the money. Give a recommendation,
  not a survey.
  Ask only for decisions that are truly the owner's, in one clear question.
- **Research before suggesting** any change to how the station operates: verify
  what the code does today (and whether it is reachable on screen), then check
  how professional ERP/POS systems and standard accounting handle it, and cite
  a few sources.
- **One mechanism over many features.** Prefer one general mechanism (an
  existing record type with an option) over new buttons, entry types or
  automatic rules. When the owner says "do away with X", remove X entirely. Keep
  designs general and configurable (other stations will use NexGen).
- **New requests and concerns:** when the owner raises several matters or
  says "don't code yet", write each as: what was asked → what exists today
  (with evidence) → what changes → ripple effects → tasks, in order of
  necessity, and agree it before coding. When the owner is unsure how
  something works (e.g. credit/debit notes), explain it plainly first.
- **Roles:** only admins create, edit, delete or approve; attendants record
  their own shift and see their own records. Enforce it on the server.
- Don't assume; check the code and docs. Do what was asked. Flag other
  problems you notice; don't fix them unasked.

## Cost discipline (tokens are money)

- Grep first; read only the lines you need. No full reads of large files
  without a reason. No sub-agents for targeted questions.
- Batch independent tool calls. Don't re-read a file you just edited.
- Type-check once per phase, not after every edit. No speculative fixes.
- Prove the backend (suite or request) before building UI on it; fix a bug
  class in every file in one pass, not one complaint at a time.
- Scripts containing quotes or apostrophes: write them to a file and run it.
  Heredocs through the Bash tool break on quotes.
- Commit messages: a clear subject, then a short body saying why and what
  changed in behaviour (the owner asked for descriptive commits). No
  file-by-file lists.

## Never

- Never start ngrok on the development PC (`station:bg`, `dev:bg` and the
  `*:tunnel` scripts all do); use `scripts/e2e`.
- Never modify `backend/data/nexgen.db` (a copy of station data) or run the
  backend on it. End-to-end tests use `scripts/e2e` on a scratch copy and must
  finish with `node scripts/e2e/fingerprint.cjs check` → `REAL-DB-UNCHANGED`.
- Never pass `NEXGEN_DATA_DIR` through `cmd /c set ...` in `.claude/launch.json`
  (it was silently lost once and migrated the dev database).
- **The GitHub repo is public.** Never commit real names, balances, PINs,
  tokens or station data. Test PINs exist only in test and scratch databases.
- Never edit a closed shift, delete a financial row, edit a pushed migration,
  or force/rebase/reset the station PC. Corrections are new dated entries.
- Never enter real credentials anywhere.

## Definition of done

- `npx tsc --noEmit -p <package>` clean for backend / desktop / mobile as touched.
- All backend suites pass (`docs/ENGINEERING-STANDARDS.md` §6 has the loop).
- Money or permission logic has tests, and a mutation check shows they catch
  planted bugs.
- UI changes verified on a scratch copy of real data in the browser pane.
- Docs and `docs/PROJECT-STATUS.md` updated.

## Layout

- `backend/`: Express + Knex + SQLite. Routes in `src/routes`, logic in
  `src/services`, migrations in `migrations/` (`YYYYMMDD_NNN_name.ts`), test
  suites in `scripts/test_*.ts` (`npm run test:<name>` in `backend/`).
- `desktop/`: React + Vite admin terminal (no login; trusted station PC).
- `mobile/`: React PIN-login web app served by the backend at `/mobile` from
  `mobile/dist` (rebuild with `npm run build:mobile`). Not a native app:
  `mobile/android/` is an old, uncommitted Capacitor scaffold; ignore it.
- `shared/`: types and UI components used by both apps (`shared/ui`).
- `scripts/`: station PowerShell scripts (`station:bg`, `dev:stop`, backups)
  and `scripts/e2e` (isolated testing).
- Local only, never committed: `.claude/plans/` (planning history with station
  data; readable at `D:\NexGen\.claude\plans\` from worktrees) and
  `.claude/launch.json`.
