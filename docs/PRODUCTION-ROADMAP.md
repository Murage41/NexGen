# NexGen Production Roadmap

This is the agreed production track for NexGen.

## Decisions

- Source of truth: the station PC or local server.
- First remote access model: Tailscale private access.
- Mobile app approach: wrap the existing React mobile app with Capacitor.
- User model: keep admins and employees.
- Storage: keep SQLite for one station; move to PostgreSQL only for true
  multi-station/cloud hosting.
- GitHub checkpoints: inspect status/diff before each major area, then commit
  and push the completed milestone before starting the next one.

## Milestones

1. Production backend runtime
   - Configurable data directory through `NEXGEN_DATA_DIR`.
   - Compiled JavaScript migrations for `npm start`.
   - Mobile bundle path configurable through `NEXGEN_MOBILE_DIST`.

2. Windows production install
   - Backend runs as a Windows service.
   - Desktop builds into an installable Electron/NSIS installer.
   - Logs and data live under `C:\ProgramData\NexGen` by default.

3. Authentication and roles
   - Split login users from employee records.
   - Admins manage accounting, settings, backups, and reports.
   - Employees get limited shift convenience access.
   - Add device/session management.

4. Backup and audit foundation
   - Nightly local backups.
   - Offsite backup target.
   - Restore verification command.
   - Audit logs for login, backup, restore, settings, price, and shift changes.

5. Tailscale mobile access
   - Station PC joins the private Tailnet.
   - Admin/employee phones join as approved devices.
   - App connects to the station using the Tailscale device name or `100.x.y.z`
     address.
   - Tailscale ACLs restrict employees to NexGen access only.

6. Android app
   - Capacitor wrapper for the existing mobile app.
   - QR/server pairing flow.
   - Secure storage for server address and device token.
   - Release signing, icon, and splash assets before broad distribution.

7. Optional cloud/domain phase
   - Domain only when branded public access, app links, or cloud sync is needed.
   - Cloud sync only after local production is stable.
