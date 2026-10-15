# Incident-Response Runbook (internal)

**Version:** v0.2 (draft) · **Owner:** [INCIDENT LEAD NAME] · **Last rehearsed:** [DATE]

> **Not legal advice.** This is an operational checklist. Notification deadlines and thresholds below are summaries that change often. **Confirm every deadline with counsel ([COUNSEL NAME, PHONE, EMAIL]) at the start of any incident that may involve personal data.** Clocks start when we *become aware* of a breach, not when the investigation ends.

## 1. Roles

One person may hold several roles in a small team; write the names down at the start of each incident.

| Role | Who | Responsibilities |
|---|---|---|
| **Incident Lead** | [NAME] | Declares the incident and severity, makes decisions, owns the timeline and the log, starts the notification clock. |
| **Technical Lead** | [NAME] | Containment, forensics, eradication, recovery (VPS, Postgres, Cloudflare, secrets). |
| **Communications** | [NAME] | Drafts user emails (via Resend), status-page/in-game notices, regulator and processor notices. |
| **Counsel** | [OUTSIDE COUNSEL] | Decides whether it is a notifiable breach, which laws apply, and the wording of notices. Engage early; route forensic findings through counsel where privilege matters. |
| **Provider contacts** | — | OVHcloud support/abuse: [ ]; Cloudflare: [ ]; Resend: [ ]; Sentry: [ ]; OAuth apps: Google / Discord / GitHub / Microsoft developer consoles; Valve partner support (once on Steam): [ ]. |

## 2. Severity levels

| Level | Definition (examples) | Response |
|---|---|---|
| **SEV-1 Critical** | Confirmed or likely access to personal data or credentials: DB dump, backup exposed, `BETTER_AUTH_SECRET` or DB password leaked, admin/VPS compromise, mass account takeover. | Immediate, all hands. Counsel within 24 h. Notification analysis required. |
| **SEV-2 High** | Possible personal-data exposure under investigation; single-account takeover via our bug; a processor reports a breach affecting our data; exposed API key (Resend, Sentry, Cloudflare, Steam Web API). | Same day. Treat as SEV-1 until scope is known. |
| **SEV-3 Medium** | Security event with no personal data involved: DDoS, credential-stuffing attempts blocked by rate limits, defacement of static site, vulnerability report without evidence of exploitation. | Within 1 business day. Log it; no notification usually needed. |
| **SEV-4 Low** | Minor misconfiguration, suspicious but benign activity. | Track in TODO.md. |

## 3. Procedure

### Step 1 — Detect and declare
- Sources: Sentry alerts, uptime alerts, Cloudflare security events, unusual Postgres/SSH logs, user reports, researcher reports to [SECURITY CONTACT EMAIL], processor notices.
- Open an incident log (template in §5). Record the **time of awareness** — this starts the GDPR 72-hour clock and US state clocks.
- Assign roles and severity. Do not discuss details in public channels.

### Step 2 — Contain
- **Preserve evidence first, quickly:** snapshot the VPS (OVH snapshot), export Docker/Caddy/Postgres/auth logs and Cloudflare logs. **Security logs auto-delete after 90 days — suspend rotation/pruning for the affected period.** Label every evidence snapshot and preserved log with the incident ID, restrict access to it, delete it when the incident is closed (record the date in the log), and re-apply `deletion_log` before any snapshot is mounted. The Privacy Policy promises that preserved copies are kept only for the incident or a legal claim.
- Cut off access: block attacker IPs/ASNs in Cloudflare WAF; enable "Under Attack" mode if needed; tighten the VPS firewall (still Cloudflare-only, plus admin IP); disable compromised admin/SSH accounts.
- If the database or backups are exposed, take the API offline behind a maintenance page if needed to stop further exfiltration. Let running games end if safe; otherwise abort them (they are recorded as unrated).

### Step 3 — Eradicate (rotate and reset)
Rotate every secret that could have been exposed, then redeploy:
- `BETTER_AUTH_SECRET` (invalidates signed cookies), the `ip_hash` HMAC pepper, Postgres passwords, backup encryption keys and R2/B2 credentials;
- OAuth client secrets (Google, Discord, GitHub, Microsoft), Steam publisher Web API key (future), Resend API key, Sentry auth tokens/DSN, Cloudflare API tokens, Turnstile secret, GitHub Actions secrets and deploy keys, SSH keys.

Then reset users as scope requires:
- **Revoke all sessions** (truncate `sessions`; Unity bearer tokens included).
- **Force password resets** for affected accounts (or all accounts): invalidate password hashes or set a "must reset" flag; send reset emails.
- If TOTP secrets may be exposed (they are encrypted, but the key may not be safe): disable TOTP and backup codes for affected users and prompt re-enrollment. Passkeys store public keys only; no reset needed unless the account itself was taken over.
- Patch the vulnerability; rebuild containers from clean images. **If restoring from a backup, re-apply `deletion_log` before reopening** so deleted accounts do not reappear.

### Step 4 — Assess scope
Answer in writing (counsel decides notifiability from this):
- **Data types:** email, username, password hash (argon2id), TOTP secret/backup codes (encrypted? key exposed?), OAuth/Steam IDs, IP addresses/security logs, `ip_hash` (was the HMAC pepper exposed? if so, treat `ip_hash` values as raw IPs and rotate the pepper), match data, support emails. Note: **email/username + password or security credentials that permit account access** is "personal information" in many states (e.g. California); hashed/encrypted data is often exempt **only if the key or salt was not also exposed**.
- **People:** number of affected users; registered vs. guest; **users in under-18 age bands (13–15, 16–17)**.
- **Location:** derive state/country for affected users from the best available signal (IP geolocation in security logs, email domain, support records). We do not collect addresses, so document the method and its limits; counsel may advise notifying all affected users regardless of location.
- **Risk:** likelihood of harm (account takeover, credential reuse, phishing), whether data was actually acquired vs. merely accessible, whether it is already encrypted/unusable.

### Step 5 — Notify
Use the checklist in §4. Notify in parallel, not in sequence. Exception: where a state requires regulator notice before individual notice (e.g., NJ: Division of State Police first), sequence those notices accordingly. User notices (via Resend email and an in-game banner) should state: what happened, when, what data, what we did, what users should do (change reused passwords, enable passkey/TOTP, watch for phishing), and a contact. Do not include unnecessary details that would help attackers. Keep copies of every notice sent, with timestamps.

### Step 6 — Post-incident review (within 2 weeks)
- Blameless write-up: timeline, root cause, what worked, what didn't.
- Action items go into **TODO.md** with owners and dates.
- Update this runbook, the Privacy Policy (if practices changed) and the breach register. Keep the incident log at least **[5] years** (GDPR Art. 33(5) requires documenting every breach; Canada requires 24 months minimum).

## 4. Notification-deadline checklist

*Non-exhaustive summary as of [DATE] — confirm with counsel. "Awareness" = discovery/determination of the breach.*

| Who | Trigger / threshold | Deadline | Done (time / by) |
|---|---|---|---|
| **Counsel** | Any SEV-1/SEV-2 | Within 24 h of awareness | |
| **EU supervisory authority** (GDPR Art. 33) — each member state where affected users live (no one-stop shop without an EU establishment) | Breach of EU users' data, unless unlikely to result in risk | **72 hours** from awareness (phased reporting allowed) | |
| **UK ICO** (UK GDPR Art. 33) | Same, for UK users | **72 hours** | |
| **EU/UK affected individuals** (Art. 34) | Likely **high** risk to individuals | Without undue delay | |
| **Canada — Privacy Commissioner (OPC) + individuals** (PIPEDA) | Real risk of significant harm | As soon as feasible | |
| **US affected individuals** — state law where each resident lives | State's definition of personal information (e.g. login credentials), **accessed or acquired** — FL, NY and others are triggered by unauthorized access alone | Most states: "without unreasonable delay"; fixed outer limits include **30 days** (e.g. CA [Cal. Civ. Code § 1798.82, from Jan. 1, 2026: 30 calendar days from discovery], CO, FL, WA, ME, NY), **45 days** (e.g. VT, OH, WI, MD, OR), **60 days** (e.g. TX, CT, DE, LA, SD) | |
| **US state attorneys general / agencies** | Thresholds vary: CA >500 residents (sample notice); WA >500; CO, FL ≥500; TX ≥250; NY, MA, VT any number (VT: preliminary notice within 14 business days); **NJ: Division of State Police, any number**; ME, MD, NH, NC and others any number (confirm) | **CA: sample notice to AG within 15 calendar days after notifying consumers.** **NJ: report to the Division of State Police BEFORE notifying any NJ customer** (N.J.S.A. 56:8-163(c)(1)). TX within 30 days. Others often same time as, or before, individual notice | |
| **Consumer reporting agencies** (Equifax, Experian, TransUnion) | Many states when more than 1,000 residents are notified (MN: more than 500); not limited to SSN breaches | Without unreasonable delay (MN: within 48 hours) | |
| **Processors / partners** | Incident at our side affecting their systems (e.g. leaked OAuth secrets → provider console; Steam key → Valve per partner agreement) | Promptly / per contract | |
| **From processors to us** | OVHcloud, Cloudflare, Resend, Sentry must notify us under their DPAs | Per DPA ("without undue delay") — our clock starts when **we** are aware | |
| **Law enforcement** | Criminal activity; may request delay of notices (get the request in writing) | As appropriate | |
| **Users (voluntary courtesy notice)** | Incidents below legal thresholds where users should act (e.g. reset a reused password) | Decide with counsel | |

## 5. Incident log template

Copy into a private file (`incidents/YYYY-MM-DD-short-name.md`, not in the public repo).

```
INCIDENT ID:            INC-YYYY-NNN
TITLE:
SEVERITY:               SEV-1 / SEV-2 / SEV-3 / SEV-4
STATUS:                 open / contained / eradicated / closed
INCIDENT LEAD:          TECH LEAD:          COMMS:          COUNSEL:

TIME OF AWARENESS (UTC):          (starts 72-hour and state clocks)
HOW DETECTED:
SYSTEMS AFFECTED:       (VPS / Postgres / backups / Cloudflare / Resend / Sentry / OAuth app / other)

TIMELINE (UTC, append-only):
  YYYY-MM-DD HH:MM  who  what was observed / done

CONTAINMENT ACTIONS:    (snapshots taken [labelled with incident ID], IPs blocked, services stopped)
EVIDENCE DELETED (UTC): (snapshots / preserved logs deleted at close)
SECRETS ROTATED:        (list each, time rotated)
USER RESETS:            sessions revoked [y/n, time]; forced password resets [count]; TOTP reset [count]
DELETION_LOG RE-APPLIED AFTER RESTORE: [n/a / yes, time]

SCOPE:
  data types:
  encrypted/hashed? key exposed? (incl. ip_hash HMAC pepper):
  users affected (registered / guest / under-18 age bands):
  locations (states / countries) and method used:
  acquired vs. accessible:

NOTIFICATIONS (each with deadline, time sent, by whom, copy saved):
  counsel:
  EU/UK regulators:
  state AGs:
  users:
  processors/partners:

ROOT CAUSE:
LESSONS / TODO.md ITEMS:
CLOSED (UTC):           APPROVED BY:
```
