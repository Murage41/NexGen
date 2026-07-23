# NexGen Production Security, Operations, and Compliance Baseline

Reviewed: 2026-07-23

This document defines the minimum baseline for putting NexGen into production
at a filling station. It is an engineering and operations checklist, not legal
or tax advice. Provider requirements, laws, prices, and platform policies must
be rechecked before each production release.

The labels used below are:

- **REQUIRED BEFORE PRODUCTION**: release blocker.
- **REQUIRED IF APPLICABLE**: blocker when the named feature or deployment
  model is used.
- **RECOMMENDED**: material risk reduction that should be scheduled.

## 1. Hosting Decision

### Preferred: dedicated NexGen host

**RECOMMENDED**

Run the NexGen backend and database on a dedicated station mini-PC/server or an
isolated virtual machine. Use the back-office PC only as a client.

Benefits:

- A NexGen restart or update cannot stop the existing POS.
- Firewall, Windows updates, Node.js, Tailscale, backups, and antivirus rules
  can be managed independently.
- Vendor support boundaries are clear.
- The database and service can run without a user signing in.

The host should have a local SSD, a UPS, BitLocker, automatic backups, and a
wired connection to the station router. Phones and desktops call the NexGen
API; they never open the database file directly.

### Transitional: share the POSitive back-office PC

This can work for a pilot or a single-station rollout, but it needs controlled
coexistence. POSitive is an Asprime Software Ltd product and may use its own
database, services, ports, firewall rules, integrations, endpoint exclusions,
licence controls, and support procedures.

**REQUIRED BEFORE PRODUCTION**

Obtain or record the following with Asprime or the station's IT provider:

- Supported Windows edition and patch level.
- POSitive service names, database engine, ports, scheduled tasks, and backup
  process.
- Whether the PC is domain-managed or has vendor Group Policy.
- Approved antivirus/Defender exclusions, if any.
- Whether third-party Node.js services, Tailscale, and a local HTTP API are
  supported on the same PC.
- eTIMS, forecourt controller, pump, printer, M-Pesa, and receipt integration
  ownership.
- Recovery responsibility if a NexGen installation affects POSitive.

Do not modify POSitive files, services, database, ports, firewall rules,
startup tasks, or exclusions. Do not install a second database engine or
replace shared runtimes without a compatibility test and a rollback plan.

Before every station change:

1. Confirm POSitive is healthy and record its version.
2. Back up NexGen and verify the backup exists.
3. Use a tested NexGen release commit and record its version.
4. Schedule a maintenance window and define rollback steps.
5. Apply the change, restart the PC, and test both systems.
6. Confirm POSitive sales, receipts, eTIMS, printing, and backups still work.
7. Confirm NexGen login, shifts, stock, reports, and backup still work.

## 2. Windows Policy and Group Policy

NexGen does not require Active Directory or Group Policy for one station.
Group Policy becomes useful when several managed PCs need identical security
settings. A single station can use documented local policies, standard user
accounts, Windows Firewall, Defender, BitLocker, and a properly installed
Windows service.

The PowerShell message stating that scripts are disabled does not prove
POSitive caused the restriction. It can come from Windows defaults, a local
administrator, a domain Group Policy, endpoint security software, or a prior
hardening policy.

Diagnose it from PowerShell:

```powershell
Get-ExecutionPolicy
Get-ExecutionPolicy -List
Get-Command npm -All
gpresult /h "$env:USERPROFILE\Desktop\NexGen-Policy-Report.html"
```

Policy precedence is `MachinePolicy`, `UserPolicy`, `Process`, `CurrentUser`,
then `LocalMachine`. A domain or local Group Policy at the first two scopes
overrides lower scopes. PowerShell execution policy is a safety feature, not a
complete security boundary.

**REQUIRED BEFORE PRODUCTION**

- Do not set the whole PC to `Unrestricted` or permanently bypass a centrally
  managed policy.
- Do not attempt to override `MachinePolicy` or `UserPolicy`.
- Continue using `npm.cmd` from PowerShell where needed; Command Prompt already
  resolves `npm.cmd` directly.
- Replace development PowerShell launchers with an installed, least-privilege
  Windows service for the compiled backend.
- If scripts remain part of administration, sign them or explicitly allow the
  exact scripts through the organisation's application-control process.
- Test AppLocker or App Control rules in a pilot before enforcement. An
  untested rule can stop both NexGen and POSitive.

The current `station:bg`, `dev:bg`, and startup-task commands are transitional
development operations. They are not the final service installation model.

## 3. Windows Host Baseline

**REQUIRED BEFORE PRODUCTION**

- Use a supported Windows Pro or Enterprise edition.
- Use a standard Windows account for normal station work and a separate local
  administrator account for installation and recovery.
- Run the backend under a dedicated local service identity with access only to
  the NexGen application, data, log, and backup paths it needs. Do not use
  `LocalSystem` unless a reviewed dependency requires it.
- Enable Microsoft Defender real-time protection and Windows Firewall.
- Do not exclude the whole NexGen folder, drive, Node.js runtime, or database
  from antivirus scanning. Any exception must be narrow, documented, and based
  on a confirmed false positive.
- Enable BitLocker on the system and NexGen data volumes and escrow the
  recovery key in a business-controlled location.
- Disable sleep and hibernation while the station is operating.
- Keep automatic screen locking enabled.
- Schedule Windows updates and reboots outside station operating hours. Test
  major feature updates before installing them on the live host.
- Protect the host, router, and network equipment with a UPS.
- Set BIOS/UEFI boot protection and restrict booting from removable media.
- Synchronise time automatically and use the `Africa/Nairobi` time zone.

Record an asset sheet containing the PC serial number, Windows edition,
BitLocker recovery-key location, NexGen version, Node.js version, Tailscale
device name, database path, backup destination, and support contacts. Do not
put passwords or API secrets in that sheet.

## 4. Files, Database, and Backups

SQLite remains suitable for one station when one backend process owns the
database. Store `nexgen.db`, its WAL files, and uploaded documents on a local
SSD on the backend host. SQLite WAL mode does not support a database opened
over a network filesystem.

**REQUIRED BEFORE PRODUCTION**

- Only the backend service identity and authorised administrators may access
  the data directory.
- Desktop and Android clients must use the authenticated API. Never share the
  SQLite folder over SMB or let a client open it.
- Run exactly one production backend process against one SQLite database.
- Keep nightly local backups, weekly encrypted offsite backups, and monthly
  retained backups.
- Use a transactionally safe SQLite backup operation. A stopped-service copy
  of the entire data directory is acceptable; an online backup API or
  controlled `VACUUM INTO` process is preferred for live backups.
- Encrypt offsite and removable backups.
- Run and document a restore test on a separate machine at least monthly.
- Alert when the latest successful backup is older than 24 hours.
- Define recovery objectives. Initial targets are RPO 24 hours and RTO 4
  hours; tighten them if the business cannot re-enter a full day manually.

Keep at least 30 daily and 12 monthly backups unless the approved retention
policy requires longer. A synchronised folder is not a backup by itself:
deletion, corruption, or ransomware can synchronise too.

Move to PostgreSQL before operating multiple backend replicas, several
branches against one database, high write concurrency, or a cloud-first
service.

## 5. Network and Tailscale

Never forward NexGen port `3001` from the internet-facing router. Do not use
ngrok as the permanent production access path.

Tailscale lets a phone reach the station from another network. The phone does
not have to be on the station Wi-Fi when both the phone and server are
authorised members of the same tailnet. Tailscale network access does not
replace NexGen login, roles, session expiry, or audit logs.

**REQUIRED IF APPLICABLE**

- Use a business-owned identity and a commercial Tailscale plan. Tailscale
  states that its Personal plan is not intended for commercial use.
- Maintain at least two business-controlled tailnet administrators with MFA.
- Enable device approval and promptly remove lost, replaced, or former-staff
  devices.
- Use Tailscale grants or ACLs with least privilege. Do not retain an
  allow-everything default.
- Tag the station server and permit only approved admin/employee device groups
  to the required NexGen port.
- Do not enable a subnet router, exit node, public Funnel, or broad LAN access
  unless a documented use case requires it.
- Keep the backend private. Bind to localhost behind a local reverse proxy, to
  the Tailscale address, or to the LAN only with a Windows Firewall rule
  restricted to the intended interface and source range.
- Review tailnet users, devices, keys, grants, and logs monthly.

For a small deployment, device approval is the simpler first control.
Tailnet Lock is an advanced alternative that requires protected signing nodes
and recovery procedures; it is not used at the same time as device approval.

If public domain access is later required, use a registered business domain,
TLS, an authenticated reverse proxy or identity-aware access gateway, and a
web application firewall. A domain is not required for Tailscale-only access.

## 6. Application and API Security

The main branch already has useful controls: authentication is applied to API
routes after login endpoints, many sensitive routes require admin access,
production secrets have minimum lengths, CORS is configurable, login attempts
are limited, SQLite uses WAL/busy timeout, and Electron uses context isolation
with Node integration disabled.

These controls do not yet make the current main branch production-ready.

**REQUIRED BEFORE PRODUCTION**

- Remove the desktop shared-key bypass. A key compiled as
  `VITE_DESKTOP_KEY` can be recovered from the installed application and is
  not a user identity.
- Require individual admin and employee accounts. Do not share an admin
  password or PIN.
- Apply server-side role and object ownership checks to every endpoint,
  including records addressed by numeric ID.
- Use long random secrets generated during installation. Keep them outside
  Git, application bundles, logs, support screenshots, and backups exported
  without encryption.
- Rotate secrets after suspected exposure and during controlled ownership
  transfer.
- Use HTTPS for any path that is not protected end-to-end by a private
  transport such as Tailscale.
- Restrict CORS to exact production origins. CORS is a browser control, not an
  API authentication control.
- Apply request-size, rate, timeout, and pagination limits to login, reports,
  uploads, exports, integrations, and expensive calculations.
- Validate all request data server-side and use parameterised database access.
- Make financial write operations transactional and idempotent where retries
  are possible.
- Record tamper-evident audit events for login, failed login, shift close,
  prices, deliveries, tank adjustments, credit payments, invoice changes,
  configuration, user/role changes, backup, restore, export, and integration
  callbacks.
- Redact passwords, PINs, tokens, customer identifiers, and payment secrets
  from logs.
- Define session expiry, forced logout, password reset, employee deactivation,
  and lost-device procedures.
- Disable development tools, source maps containing sensitive implementation
  details, default credentials, and verbose errors in production builds.

No mobile or desktop client may be trusted to calculate authoritative stock,
cash, debt, tax, or permissions. The backend validates and records the final
business transaction.

## 7. External API Controls

Every external integration needs:

- Separate sandbox and production credentials.
- A business-owned provider account with at least two recovery contacts.
- Secret storage outside the repository and client applications.
- Timeouts, bounded retries with backoff, idempotency keys, and duplicate
  callback handling.
- A durable queue or reconciliation process for interrupted requests.
- Provider transaction IDs and status history.
- Monitoring and an operational runbook for provider downtime.
- Least-privilege credentials and a documented rotation/revocation process.
- Test fixtures that cannot call production or move real money.

### Safaricom Daraja / M-Pesa

**REQUIRED IF APPLICABLE**

Complete Safaricom's production onboarding; sandbox credentials are not
production credentials. Expose callbacks only over HTTPS. Verify and
deduplicate callbacks, reconcile them against provider records, and never mark
a payment complete solely because the phone or browser reports success.

Credit/debt payments must use one authoritative payment record. Whether a
payment starts in Credits, the shift screen, desktop, or mobile, the backend
must enforce the same posting, allocation, shift-attribution, reversal, audit,
and reconciliation rules.

### KRA eTIMS and fuel-station invoicing

**REQUIRED IF APPLICABLE AND REQUIRED BEFORE REPLACING THE FISCAL POS**

KRA requires petroleum retailers to implement the eTIMS Fuel Station System,
integrated through the forecourt controller and existing POS for real-time
transaction invoicing. KRA announced enforcement after 31 December 2025.

Until the integration responsibility is confirmed:

- Keep POSitive as the authoritative fiscal receipt/eTIMS system if that is
  its present role.
- Use NexGen as the operational ERP/accounting record and reconcile its sales
  to POSitive/eTIMS.
- Do not let both systems issue a fiscal invoice for the same sale.
- Do not replace per-transaction fiscal behaviour with a shift aggregate based
  on an assumption.

If NexGen will replace the physical POS or issue tax invoices, implement the
current KRA-approved fuel-station route with an approved eTIMS integrator or
approval process. Document forecourt-controller ownership, invoice numbering,
offline behaviour, retry/idempotency, rejection handling, cancellation/credit
notes, and daily reconciliation before go-live.

## 8. Kenya Data Protection

NexGen processes employee, customer, supplier, invoice, credit, and payment
information. The station business will normally act as a data controller;
hosting, messaging, crash-reporting, cloud-backup, and support providers may
act as processors.

**REQUIRED BEFORE PRODUCTION**

- Confirm with the ODPC or qualified Kenyan counsel whether the business must
  register as a data controller/processor. Do not assume a small-business
  exemption applies.
- Publish a privacy notice describing data, purpose, lawful basis, recipients,
  retention, transfers, security, and data-subject rights.
- Collect only the personal data needed for the transaction.
- Define retention periods for employee, customer, supplier, financial,
  security, and backup records. Tax/accounting retention duties may prevent
  immediate deletion of a ledger transaction.
- Put processor and confidentiality terms in contracts with hosting, backup,
  support, messaging, analytics, and payment providers.
- Review safeguards for data hosted or supported outside Kenya.
- Restrict exports and support access; record who accessed or exported data.
- Maintain a breach-response plan and current ODPC contacts.

Under the Data Protection Act, a controller may need to notify the Data
Commissioner within 72 hours of becoming aware of a qualifying breach. A
processor should notify the controller without delay and, where reasonably
practicable, within 48 hours. The incident plan must preserve evidence,
contain access, assess affected data, notify decision-makers, and document the
notification decision.

## 9. Android Distribution

Choose and document one distribution path:

- **Managed/private deployment** for station-owned devices: preferred for the
  first production rollout.
- **Public Google Play listing** for customer or broadly distributed devices:
  use only when ongoing policy, privacy, support, and update obligations are
  staffed.
- **Direct APK installation**: acceptable only for a tightly controlled pilot
  with a protected signing key, checksum verification, device inventory, and
  a reliable update/revocation process.

**REQUIRED IF APPLICABLE**

- Sign release builds with a business-owned Android signing key. Back it up
  offline and restrict access.
- Use different application IDs, credentials, and API targets for test and
  production.
- Publish a privacy policy and complete Google Play Data Safety disclosures
  accurately when Play distribution requires them.
- If the app allows account creation, implement the current Google Play
  account-deletion requirements, including an external deletion request path.
  Explain any financial records retained for legal obligations.
- Meet the target Android API level required by Google Play at release time
  and budget for regular updates.
- Store no backend master secret in the APK. Use user login and revocable
  sessions.
- Support remote account/session revocation for lost phones.
- Test supported Android versions, poor connectivity, duplicate submissions,
  interrupted sync, clock differences, and app upgrades.

The Android app should be an online client of the station API for the first
production version. Offline financial writes and bidirectional database sync
require conflict rules, local encryption, replay protection, and reconciliation
and should be a separate implementation phase.

## 10. Product and Dependency Licensing

The root package is currently private but declares `ISC`, and the repository
does not currently contain a root `LICENSE`, `NOTICE`, or commercial EULA.
That ambiguity must be resolved before distributing installers or APKs.

**REQUIRED BEFORE PRODUCTION DISTRIBUTION**

- Decide whether NexGen is proprietary/commercial or open source.
- For a proprietary product, keep packages private, replace misleading
  open-source package metadata, and add a reviewed EULA/commercial licence.
- Define installation limits, authorised stations/users, ownership of station
  data, backup/export rights, support, updates, termination, warranty,
  liability, and service availability.
- Add privacy/data-processing terms and a support/security contact.
- Inventory direct and transitive dependency licences. Review copyleft,
  attribution, redistribution, binary, font, icon, and media obligations.
- Generate a software bill of materials and third-party notices for each
  release.
- Record licences/subscriptions for Windows, code signing, Tailscale,
  Google Play or managed mobility, domain/TLS, cloud backup, SMS/email, and
  payment services.

Do not copy code, database structures, assets, credentials, or proprietary
interfaces from POSitive or another ERP without permission. Interoperability
must use documented or vendor-approved APIs and the station's authorised data.

## 11. Release and Update Security

The root dependency audit run with `--omit=dev` on 2026-07-23 reported 33
vulnerabilities: 3 low, 8 moderate, 20 high, and 2 critical. The root manifest
currently lists many transitive and build-tool packages as direct production
dependencies, so the audit must be classified after the manifests are cleaned
up. The result also changes as advisories and packages change.

**REQUIRED BEFORE PRODUCTION**

- Normalise each workspace manifest. Keep only actual direct runtime
  dependencies in `dependencies` and put build/test/packaging tools in
  `devDependencies`.
- Resolve, remove, replace, or formally assess every critical and high
  production-runtime finding.
- Do not run `npm audit fix --force` on the live station. Update in a branch,
  review breaking changes, rebuild, and run regression tests first.
- Pin and test a supported Node.js LTS release. Do not operate on an
  end-of-life runtime.
- Produce builds from a clean tagged Git commit in a controlled CI/release
  environment.
- Build backend, desktop, and Android artifacts once; promote the same tested
  artifacts rather than rebuilding independently at each station.
- Sign the Windows installer and executable with a trusted code-signing
  certificate. Sign Android releases with the protected Android key.
- Publish checksums and an SBOM with each release.
- Keep a release manifest containing commit, schema migration, Node/Electron
  versions, build time, checksums, and rollback compatibility.
- Back up before update, run migrations once, perform a health check, and
  verify restore/rollback compatibility before declaring success.
- Never downgrade across an irreversible database migration without a tested
  restore.

Electron and Node.js must be reviewed on a regular patch cycle. Unsigned
installers and the current development startup model are not acceptable as the
final production package.

## 12. Production Release Gates

A release is ready for a station pilot only when every applicable item is
recorded as pass, fail, risk accepted by owner, or not applicable:

- Hosting decision and Asprime coexistence approval.
- Clean restore test from the intended backup process.
- Windows restart and unattended backend service test.
- POSitive regression test on any shared PC.
- Individual login, role, session, and lost-device tests.
- Firewall/Tailscale least-privilege test from allowed and denied devices.
- No unresolved critical/high runtime vulnerability without written risk
  acceptance and mitigation.
- Secrets generated, stored, rotated, and excluded from artifacts/logs.
- Signed desktop installer and Android package.
- Licence/EULA, third-party notices, SBOM, privacy notice, and retention policy.
- ODPC registration assessment and incident-response contacts.
- eTIMS/fiscal ownership confirmed; no duplicate or missing fiscal invoices.
- Payment callback duplicate, delay, failure, and reconciliation tests.
- Load/stress, disk-full, power-loss, network-loss, clock, and restart tests.
- Monitoring for service health, disk space, failed login, integration failure,
  and stale backup.
- Tested rollback and named person authorised to perform it.

Main and the production-readiness branch must be reconciled and retested after
all current main features are included. Do not deploy an older hardened branch
that omits later accounting, stock, invoice, delivery, or shift fixes.

## 13. Authoritative References

- [Asprime Software Ltd](https://www.asprime.co.ke/)
- [Microsoft PowerShell execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)
- [Microsoft PowerShell Group Policy settings](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_group_policy_settings)
- [Microsoft AppLocker overview](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/applocker/applocker-overview)
- [Microsoft Security Compliance Toolkit](https://learn.microsoft.com/en-us/windows/security/operating-system-security/device-management/windows-security-configuration-framework/security-compliance-toolkit-10)
- [Microsoft BitLocker overview](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/)
- [Microsoft Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
- [Microsoft service logon accounts](https://learn.microsoft.com/en-us/windows/win32/ad/about-service-logon-accounts)
- [Tailscale plans](https://tailscale.com/pricing?plan=business)
- [Tailscale grants and ACLs](https://tailscale.com/docs/features/access-control/grants)
- [Tailscale device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)
- [Tailscale Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock)
- [Kenya Data Protection Act](https://new.kenyalaw.org/akn/ke/act/2019/24/eng%402019-11-15)
- [Office of the Data Protection Commissioner](https://www.odpc.go.ke/)
- [ODPC breach reporting](https://www.odpc.go.ke/report-a-data-breach/)
- [KRA eTIMS](https://www.kra.go.ke/online-services/etims)
- [KRA eTIMS system-to-system integration](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration)
- [KRA fuel-station eTIMS notice](https://www.kra.go.ke/news-center/public-notices/2331-reminder-on-implementation-of-electronic-tax-invoicing-for-fuel-stations)
- [Safaricom Daraja developer portal](https://developer.safaricom.co.ke/)
- [Google Play user-data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Google Play Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)
- [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/16561298?hl=en)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x03-introduction/)
- [SQLite online backup API](https://www.sqlite.org/backup.html)
- [SQLite appropriate uses](https://www.sqlite.org/whentouse.html)
- [SQLite WAL limitations](https://www.sqlite.org/wal.html)
