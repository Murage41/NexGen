# Codex Project Notes

Every agent working on NexGen (Claude Code, Codex or any other) follows the same
project files. Read them first; they are the single source of truth:

- `CLAUDE.md`: session rules (start/end of session, cost discipline, what never
  to do, definition of done). It applies to Codex as written.
- `docs/PROJECT-STATUS.md`: current state, station version, pending updates.
- `docs/ROADMAP.md`: what is left to build, in order.
- `docs/ENGINEERING-STANDARDS.md`: how to build, test and deploy, including the
  station PC update rule (§7): commit and push only when the owner asks,
  `git merge --ff-only` per update, backup before migrations,
  `npm run build:mobile`, `npm run station:bg`, one command block per update.

Keep those files current at the end of every session instead of adding rules
here, so all agents stay consistent.
