# Hosting on a UWaterloo CSC machine (no sudo, no subscriptions)

This guide is the free alternative to [DEPLOY.md](DEPLOY.md): the game runs on a machine from
the University of Waterloo Computer Science Club (CSC) where you are **not** an administrator
(no `sudo`). The only thing you pay for is the domain name. Everything else uses free tiers.

It assumes no server experience. Every command can be copied and pasted as it is. Budget about
two hours the first time.

> **Already have `sudo` on your CSC VM?** Then the normal [DEPLOY.md](DEPLOY.md) (Docker) is
> simpler: skip its OVHcloud step and do the rest on the VM. CSC cloud VMs have historically
> been created from standard cloud images where you are the admin; this guide is for the case
> where you are not.

## The short answer

**Yes, it works,** with three caveats you should accept knowingly:

| Question                        | Answer                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does it work without sudo?      | **Yes.** Node.js, PostgreSQL, the bot engine and the Cloudflare Tunnel all run as your normal user from `~/game`, and cron keeps them alive. The scripts here were run end to end as a normal user with no root access: setup, install, update, rollback, crash recovery, backup and restore. |
| Do I need to open ports?        | **No.** A Cloudflare Tunnel connects outward to Cloudflare, so no ports below 1024, no certificates and no firewall changes. Your forwarded ports aren't needed.                                                                                                                            |
| Is it allowed?                  | **Probably, for a free, non-commercial beta.** The machine usage agreement says use is "intended for personal or course work", and the web hosting rules forbid commercial use, citing university policy. Ads, payments or a company behind the game would break the rules. **Email syscom before you launch** (template below). |
| Is it reliable?                 | **Best effort.** CSC says its machines "will not be up at all times, and may crash". Its CloudStack cloud failed in Winter 2025 and is being rebuilt. Fine for a proof of concept; plan on a few outages, and keep off-site backups so you can move quickly.                                  |
| What does it cost?              | The domain (about $10–15 a year) plus the CSC membership ($2 a term). Everything else is free.                                                                                                                                                                                              |
| What happens if I stop renewing? | CSC deletes your cloud resources when your membership expires. Renew every term (alumni can stay members), or move first.                                                                                                                                                                 |

## What I found about the CSC offering

I couldn't log in to a CSC machine, so these facts come from the CSC's public pages (linked in
[Sources](#sources)). Confirm the parts marked **ask** with syscom.

- **Cloud VMs.** The CSC cloud lets members "create your own virtual machines", run Docker
  images and use Kubernetes. The documented limit per member was 8 CPU cores, 8 GB RAM and
  40 GB disk. You activate it with `ceo cloud account activate` on a CSC machine.
- **The cloud is in transition.** The CSC wiki says CloudStack "blown up during Winter 2025"
  and proposes a replacement built on Proxmox. The machine list now shows a "User Cloud
  (Proxmox)" cluster. The member docs site (`docs.cloud.csclub.uwaterloo.ca`) didn't respond
  when I checked. **Ask** what you get today: OS, CPU, RAM, disk, and whether you have sudo.
- **Why you may not get sudo.** Under Proxmox, syscom creates member machines by hand (named
  `<watiam>-<whatever>`), keeps its own root key on each, and is told to consider a
  lightweight container (LXC) before a full VM. Either way, this guide works the same: it
  only needs a normal account, cron, `curl` and `tar`.
- **Networking.** Cloud VMs sit on a private campus network (172.19.134.0/24) behind NAT.
  Public web traffic reaches them through CSC's reverse proxy ("vhosts" on `*.csclub.cloud`,
  or a custom domain by asking syscom). General-use machines have these ports open in the
  campus firewall: 22 (SSH), 60000–61000 (mosh) and 28000–28500 (TCP/UDP general use). The
  tunnel used here needs none of them; it only needs **outbound** access to Cloudflare.
- **Databases.** Members can create a PostgreSQL database with `ceo postgresql create`. It
  lives on caffeine, the CSC web server. This guide runs a private PostgreSQL instead (see
  below for why), but the scripts can use the CSC one.
- **Disk on general-use machines.** Members get "4 GB of disk quota that is accessible across
  all of our machines" (home directories are on NFS, a network filesystem). That's tight and
  slow for a database. **Use a VM** if you can; if all you get is a general-use machine, read
  [If you only get a general-use machine](#if-you-only-get-a-general-use-machine).
- **Long-running jobs.** The machine list asks members to `nice` long-running CPU-heavy jobs
  "and possibly let syscom know". The scripts run the bot engine with `nice`, and the email
  below tells syscom.
- **Policy** ([Machine Usage Agreement](https://csclub.uwaterloo.ca/resources/machine-usage-agreement/)):
  one person per account; use "intended for personal or course work"; don't use resources to
  the point that others can't; syscom may stop processes that break the rules; the same rules
  apply to the CSC Cloud. The [web hosting page](https://wiki.csclub.uwaterloo.ca/Web_Hosting)
  adds: no ads and no start-up sites, because "using our machines for commercial purposes is
  forbidden by university policy", and sites may be taken down without notice.

### Why the scripts run their own PostgreSQL

The CSC database lives on caffeine, the shared web server; CSC's web hosting page asks
members to run anything computationally expensive on another machine. You'd also depend on
caffeine being reachable from your VM and up. A private PostgreSQL on your VM
keeps the database next to the server, makes the nightly backup yours, and lets
`restore.sh` restore it. It uses about 75 MB of RAM.

## How the pieces fit

```
 Player's browser / mobile app
   │
   ├── https://play.yourdomain.com ──► Cloudflare Pages        (the web app; free)
   │
   └── https://api.yourdomain.com  ──► Cloudflare ◄──tunnel── your CSC VM (outbound only)
                                                               │  everything runs as you, in ~/game
                                                               ├── server       127.0.0.1:39300
                                                               ├── bot-service  127.0.0.1:39301
                                                               └── postgres     127.0.0.1:39302
                                       cron: @reboot start.sh · every minute watchdog.sh · 03:15 backup.sh
```

- **Nothing listens on the internet.** All three programs listen on `127.0.0.1` only.
  `cloudflared` connects out to Cloudflare, and Cloudflare forwards `api.yourdomain.com` back
  through that connection, WebSockets included. This also gets past the VM's NAT.
- **The server only trusts Cloudflare.** The server runs with `TRUST_CLOUDFLARE=true`, which
  production requires: it reads each player's real IP from Cloudflare's header. A port
  opened straight to the internet would let anyone fake that header and dodge the rate limits,
  and you can't firewall it without root. The tunnel avoids the problem.
- **You build releases at home.** Your own computer builds a release file with Docker, the
  same build as the Docker deployment. The VM never compiles anything, so it doesn't need
  Docker, Rust or a C compiler, just `curl` and `tar`.
- **Cron keeps it running.** A per-minute watchdog restarts anything that died, restarts a
  server that stops answering, and backs off when something keeps crashing. This replaces
  Docker's `restart: unless-stopped`, which you can't have without root.

**Resources measured at idle:** about 300 MB RAM for the server, 75 MB for PostgreSQL and 6 MB
for the bot service. Disk use is about 650 MB with one release and about 900 MB once three
releases are kept. Each bot search
uses one CPU core while it thinks, at lower priority (`nice`), so it never slows the game server.

## Costs

| Item                                                                   | Cost                                       |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| Domain name (e.g. Cloudflare Registrar, which sells at cost)           | ≈ $10–15 per year                          |
| CSC membership                                                         | $2 per term                                |
| Cloudflare: DNS, Tunnel, Pages, Turnstile                              | Free                                       |
| Resend (verification and password-reset emails)                       | Free: 100 emails/day, 3,000/month          |
| Off-site backups (pick one, see step 8)                                | Free (within each provider's free storage) |
| CSC VM, Node.js, PostgreSQL, cloudflared, age, rclone                  | Free                                       |

Cloudflare may ask for a payment card when you first open the Zero Trust area (where tunnels
live) or turn on R2. The free plans don't charge it.

## Before you start: email syscom

Send something like this from your CSC address to `syscom@csclub.uwaterloo.ca`. A yes in
writing protects you if anyone asks later, and the answers fill in the "ask" items above.

> Hi syscom,
>
> I'd like to host a personal, non-commercial project on my CSC cloud VM: a free browser
> strategy game (open beta, no ads, no payments). It would run as my own user, with no root:
> a Node.js server, a small PostgreSQL and a bot engine, all on 127.0.0.1, kept alive by my
> crontab (@reboot plus a per-minute watchdog). Public access goes through an outbound
> Cloudflare Tunnel (TCP/UDP port 7844 to Cloudflare), so nothing new needs to be opened.
> Expected load: around 0.5 CPU and 500 MB RAM most of the time, with short bursts on 2 cores.
>
> Is this OK under the machine usage policy? And could you tell me what my VM gets today
> (OS, CPU/RAM/disk) and whether the cloud migration will affect it?
>
> Thanks!

## Step 1: Accounts and keys (about 45 minutes)

Do steps 1 and 2 of [DEPLOY.md](DEPLOY.md), with these differences:

- **Skip OVHcloud.** The CSC VM replaces it.
- **Tunnel public hostname:** when you add `api.yourdomain.com` to the tunnel, set the
  service to **`HTTP`** and **`127.0.0.1:39300`** (not `server:3000`, which is the Docker
  name). If you change `SERVER_PORT` later, change it here too.
- **Skip the random secrets.** `setup.sh` creates them for you.

## Step 2: Build a release on your computer (about 15 minutes the first time)

On your own computer, in the project folder, with Docker running:

```sh
git pull
infra/csclub/package.sh
```

It prints the path of the release file, e.g.
`dist/csclub/game-release-1a2b3c4d5e6f.tar.gz` (about 20 MB). Later builds take 2–3 minutes.
Only committed code goes into a release, so local edits you haven't committed can't
reach players.

## Step 3: Copy it to the VM

```sh
scp dist/csclub/game-release-*.tar.gz YOURUSER@YOUR-VM:
ssh YOURUSER@YOUR-VM
```

(Use the VM's address from the CSC cloud dashboard. If the VM has only a private address, add
`-J YOURUSER@corn-syrup.csclub.uwaterloo.ca` to both commands to hop through a general-use
machine.)

First, a quick check on the VM. The bot engine needs glibc 2.34 or newer (Debian 12, Ubuntu
22.04 or later):

```sh
ldd --version | head -n 1      # e.g. "ldd (Debian GLIBC 2.36-9) 2.36" is fine
uname -m                       # must say x86_64
```

## Step 4: One-time setup on the VM (about 5 minutes)

```sh
tar -xzf game-release-*.tar.gz
game-release-*/scripts/setup.sh
```

This creates `~/game`, writes `~/game/game.env` with fresh random secrets, downloads Node.js,
PostgreSQL, cloudflared, age and rclone into `~/game/tools`, and creates the database. It
never asks for a password and never writes outside `~/game`. Each download is checked against
a pinned checksum or the publisher's checksum list. You can run it again at any time; it skips whatever is already done.

Now fill in the settings:

```sh
nano ~/game/game.env          # Ctrl-O to save, Ctrl-X to exit
```

Set `API_PUBLIC_URL`, `WEB_ORIGIN`, `PASSKEY_RP_ID`, `CLOUDFLARE_TUNNEL_TOKEN`, the two
Turnstile keys, `RESEND_API_KEY` and `EMAIL_FROM`. Leave the three generated secrets as they
are. Then **copy the whole file into your password manager**: it's the only copy of the
secrets.

## Step 5: Install and start (about 2 minutes)

```sh
game-release-*/scripts/install.sh
~/game/current/scripts/status.sh
```

`install.sh` applies the database migrations, starts everything and waits for the server's
health check. `status.sh` should show every process as running and `health: ok`. Within a
minute, `https://api.yourdomain.com/api/health` should answer `{"status":"ok","db":"ok"}`.

If the server refuses to start, `install.sh` prints the last lines of its log. The first
error line names the missing or unsafe setting. Fix it in `game.env` and run
`~/game/current/scripts/start.sh`.

Once it's healthy, the copy in your home folder is no longer needed (the release now lives
in `~/game/releases`): `rm -rf ~/game-release-*`.

## Step 6: Keep it running with cron

```sh
crontab -l 2>/dev/null          # anything already there? then use `crontab -e` and add the lines instead
crontab ~/game/current/scripts/crontab.example
crontab -l                      # check
```

This installs three jobs:

- start everything at boot (`@reboot`);
- run the watchdog every minute;
- run the backup at 03:15 every night.

Even if a machine doesn't support `@reboot`, the watchdog starts everything within a minute
of cron starting.

**Alerts.** The watchdog raises an alert when it restarts something, when something keeps
crashing, when the disk is nearly full, and when there has been no backup (or no off-site
upload) for 2 days. Alerts always go to `~/game/logs/watchdog.log`. To have them reach you:

- **Phone or Discord (works without mail on the machine):** set `ALERT_WEBHOOK_URL` in
  `~/game/game.env`, either to a Discord channel webhook (channel → Settings → Integrations
  → Webhooks) or to `https://ntfy.sh/<long-random-name>` and subscribe to that topic in the
  free ntfy app. Treat the URL like a password: anyone who has it can read or send alerts.
- **Email:** put your address in the crontab's `MAILTO=` line (`crontab -e`). This needs
  working mail on the machine, which a no-sudo VM may not have.
- **When the whole machine is down** the watchdog can't tell you anything. Add a free
  outside check: an uptime monitor such as UptimeRobot (free plan, checks every 5 minutes and
  emails you) pointed at `https://api.yourdomain.com/api/health`.

## Step 7: The web app on Cloudflare Pages

This is exactly step 5 of [DEPLOY.md](DEPLOY.md), and it stays free: GitHub builds the web app
and uploads it to Cloudflare Pages on every push to `main`. Then open
`https://play.yourdomain.com`.

## Step 8: Backups (about 20 minutes)

1. **Make a backup key**, then move the private half off the VM:

   ```sh
   ~/game/tools/bin/age-keygen -o ~/game/backup-key.txt  # prints "Public key: age1..."
   cat ~/game/backup-key.txt                             # copy ALL of it into your password manager
   rm ~/game/backup-key.txt
   ```

   (`~/game` is readable only by you; your home folder may not be.)

   Put the `age1...` public key in `~/game/game.env` as `BACKUP_AGE_RECIPIENT`. Backups can
   only be read with the private key, so anyone who gets into the VM can't read them.
2. **Test it:** `~/game/current/scripts/backup.sh --local` writes an encrypted file to
   `~/game/backups`. The nightly job keeps 7 days there (`BACKUP_LOCAL_DAYS`).
3. **Off-site copy (strongly recommended).** If the VM disappears (an outage, the cloud
   migration, a lapsed membership), the local copies go with it. Pick one free option and set
   it up with `~/game/tools/bin/rclone config` (interactive; name the remote `offsite`):

   | Option                                                             | Free storage | Notes                                                                       |
   | ------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------- |
   | [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/)     | 10 GB        | Same account as everything else; may need a card on file to turn on        |
   | [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing)    | 10 GB        | Separate account                                                            |
   | Google Drive (rclone's `drive` type)                               | 15 GB        | Your personal account works; the files are encrypted, so that's fine        |
   | Your own computer                                                  | your disk    | No account: run `scp YOURUSER@YOUR-VM:game/backups/* ~/game-backups/` regularly |

   Then set `BACKUP_REMOTE=offsite:game-backups` in `game.env` and test with
   `~/game/current/scripts/backup.sh`. It uploads, then deletes off-site copies older than
   `BACKUP_RETENTION_DAYS` (30). A dump is a few KB now and grows with players. The free tiers
   last a long time.
4. **Practise a restore once** (see below). A backup you've never restored is a hope, not a
   backup.

## Updating the game

On your computer:

```sh
git pull && infra/csclub/package.sh
scp dist/csclub/game-release-NEWVERSION.tar.gz YOURUSER@YOUR-VM:
```

On the VM:

```sh
~/game/current/scripts/install.sh ~/game-release-NEWVERSION.tar.gz
rm ~/game-release-NEWVERSION.tar.gz     # once it says "live and healthy"
```

The update works like the Docker version:

1. It applies the database migrations while the old server is still running.
2. It stops the old server, letting running games finish (up to 45 minutes), then starts the
   new one.
3. It keeps going if your SSH connection drops. Progress is in `~/game/logs/install.log`.

Add `--now` to restart at once, which aborts running games.

**To roll back:** `~/game/current/scripts/install.sh --rollback`. This switches to the
previous release; database migrations aren't undone. Three releases are kept.

## Day-to-day commands

| What                          | Command                                    |
| ----------------------------- | ------------------------------------------ |
| Is everything OK?             | `~/game/current/scripts/status.sh`         |
| Watch the server log          | `tail -f ~/game/logs/server.log`           |
| What has the watchdog done?   | `tail ~/game/logs/watchdog.log`            |
| Stop (games finish first)     | `~/game/current/scripts/stop.sh`           |
| Stop now / also stop Postgres | `stop.sh --now` / `stop.sh --now --all`    |
| Start again                   | `~/game/current/scripts/start.sh`          |
| Back up now                   | `~/game/current/scripts/backup.sh`         |

After `stop.sh`, the watchdog leaves everything alone until you run `start.sh`. Logs over 20 MB
are rotated automatically, and the last three are kept.

## When the VM reboots or goes down

- **Reboot (planned or not):** `@reboot` runs `start.sh`, and the watchdog catches anything
  it missed within a minute. PostgreSQL recovers from a crash by itself. It was tested by
  killing every process mid-run and starting again. Players lose games that were in progress,
  as with any server restart.
- **Planned maintenance announced by syscom:** optionally run `stop.sh` an hour before, so
  running games end cleanly and no new ones start. Run `start.sh` afterwards, or let
  `@reboot` do it.
- **Something keeps crashing:** after 5 starts in 15 minutes, the watchdog retries only every
  10 minutes and sends one alert. Read `~/game/logs/<name>.log`, fix it, then run `start.sh`,
  which also resets the back-off.
- **While the VM is down:** the web app still loads (it's on Cloudflare Pages), but it can't
  connect, and the API shows Cloudflare error 1033 (tunnel offline). Nothing to do but wait,
  or move.
- **The VM is gone for good** (deleted, the migration went wrong, membership lapsed): set up
  any Linux machine, CSC or not, with steps 3–6, then restore the newest off-site backup
  (below). Expect about 30–60 minutes. **Before step 4, put your saved `game.env` back**
  (from your password manager) so `setup.sh` keeps your secrets instead of making new ones:
  `mkdir -p ~/game && chmod 700 ~/game && nano ~/game/game.env && chmod 600 ~/game/game.env`.
  New secrets would sign everyone out and make what is encrypted with the old
  `BETTER_AUTH_SECRET` (two-factor secrets, stored sign-in provider tokens) unreadable. Moving the tunnel needs no DNS change: the same token
  works on the new machine (stop the old one first if it still runs).

## Restoring a backup

```sh
# If the backup is off-site, fetch it first:
~/game/tools/bin/rclone copy offsite:game-backups/game-<date>.sql.gz.age ~/game/backups/
# Paste your private backup key into a file only you can read, restore, then delete the key:
nano ~/game/backup-key.txt
~/game/current/scripts/restore.sh ~/game/backups/game-<date>.sql.gz.age ~/game/backup-key.txt
rm ~/game/backup-key.txt
```

`restore.sh` checks that the file decrypts and is complete before touching anything, then asks
you to type `RESTORE`. Then it:

1. stops the server;
2. recreates the database and loads the backup;
3. applies any database changes from updates installed after the backup was taken;
4. **deletes again any account that was deleted after the backup** (privacy-law requirement);
5. starts everything.

If a step fails, it says so and leaves the game stopped; fix the error and run it again.
`restore.sh` only handles the private PostgreSQL. With an external `DATABASE_URL`, restore
by hand: decrypt with `age -d -i KEY FILE | gunzip > restore.sql`, load it into an empty
database with `psql`, then run `install.sh` again for the same release (it applies the
migrations) and the `reapply-deletions` step from [DEPLOY.md](DEPLOY.md#restoring-a-backup).

## If you only get a general-use machine

The guide assumes a VM (or container) of your own. If syscom can only offer a general-use
machine (corn-syrup, high-fructose-corn-syrup and so on), the scripts still run, but check
these first and raise them in your email:

- **Disk.** The 4 GB quota is shared with your mail and files. The game needs about 0.7 GB
  plus the database and 7 days of backups. `quota -s` and `du -sh ~` show where you stand.
- **Home folders are on NFS.** A database on a network filesystem is slow and can be damaged
  if the network hiccups. **Ask** for a directory on the machine's local disk that survives
  reboots, and whether cron jobs can read your home folder at all (on some NFS setups a cron
  job has no login ticket and can't). If you get a local directory, say `/local/you/game`:
  - add `export GAME_HOME=/local/you/game` to `~/.bashrc`, log out and in, and replace `~/game`
    with that path in every command in this guide;
  - in the crontab, add the line `GAME_HOME=/local/you/game` above the jobs and replace
    `$HOME/game` in each job with `/local/you/game`.
- **Other members share the machine.** Anyone logged in can reach ports on `127.0.0.1`. The
  database needs a password, but the bot engine and the game server don't, and someone could
  talk to the server directly with a made-up Cloudflare IP header to get around the rate
  limits. On your own VM this doesn't matter; on a shared machine it's a real (if small)
  gap until the server learns to check a shared secret from the tunnel.
- **Crontabs are per machine.** Install the crontab on the machine that runs the game, and
  only there.

## If something goes wrong

| Symptom                                        | Where to look                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.yourdomain.com` shows error 1033          | The tunnel is down. `status.sh`, then `tail ~/game/logs/cloudflared.log`. "Registered tunnel connection" means it works. Repeated connection errors to port 7844 mean the network blocks it: ask syscom.                                       |
| Error 502 through the tunnel                   | The tunnel works but can't reach the server: the tunnel's service must be `http://127.0.0.1:39300` (or your `SERVER_PORT`).                                                                                                                       |
| `setup.sh` says a port is taken                | Pick other free ports for `SERVER_PORT` / `BOT_PORT` / `PG_PORT` in `game.env`, update the tunnel's service, run `setup.sh` again.                                                                                                              |
| "socket path is too long"                      | Uncomment `PG_SOCKET_DIR=/tmp/<you>-game-pg` in `game.env`.                                                                                                                                                                                       |
| Server keeps restarting                        | `tail -n 50 ~/game/logs/server.log`: the first error names the missing or unsafe setting.                                                                                                                                                         |
| No verification emails                         | Resend dashboard → Logs. Is the domain verified? The free tier allows 100 emails a day.                                                                                                                                                           |
| Bots play weak, random-looking moves           | `tail ~/game/logs/bot-service.log`. If bot-service is down, the server falls back to simple moves.                                                                                                                                                 |
| `status.sh` says STOPPED                       | Someone ran `stop.sh`. Run `start.sh`.                                                                                                                                                                                                         |
| Disk nearly full                               | `du -sh ~/game/*`. Old releases are pruned automatically; old backups after 7 days. The watchdog warns once a day below 1 GB free.                                                                                                              |

## CSC VM vs the OVH VPS plan

| What                        | CSC VM (this guide)                                                                                                         | OVHcloud VPS ([DEPLOY.md](DEPLOY.md))                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Monthly cost                | **$0** (domain ≈ $1/month averaged, $2/term membership)                                                                     | ≈ $9–15/month + domain                                                                   |
| Setup effort                | Similar: about 2 hours, plus the syscom email                                                                               | About 2 hours                                                                            |
| Updates                     | Build at home, `scp`, `install.sh` (3 commands)                                                                             | `git pull` and one `docker compose` command on the server                                |
| Reliability                 | Best effort; no uptime promise; recent cloud outage; campus power and network events                                        | Commercial 99.9% target; you can reboot or reinstall it yourself any time                |
| Control                     | No root: you can't install system packages or change the firewall; syscom can stop processes                                | Full root                                                                                |
| Policy risk                 | Must stay non-commercial (no ads, payments or company); can be taken down without notice; needs a renewed membership       | None beyond normal terms of service                                                      |
| Privacy / legal             | Player data sits on university hardware that syscom can access; the privacy policy must name the host (see below)           | Covered by OVH's data processing agreement; the privacy policy already names OVHcloud    |
| Performance                 | Fine for a beta: VM limits were 8 cores / 8 GB; the game needs about 0.5 GB idle                                           | 4 vCPU / 8 GB dedicated to you                                                           |
| Growth                      | Not for a public launch with many players                                                                                  | Upgrade the plan in a few clicks                                                         |
| Moving away later           | Easy: back up, then restore on any Linux machine or the Docker stack (same database)                                       | Already the target setup                                                                 |

**Recommendation:** the CSC VM suits the proof-of-concept beta you described. Move to a paid
VPS (DEPLOY.md, same database and backups) if the game outgrows a hobby or ever earns money,
or if CSC outages start to hurt.

## Things to change in the project if you go this way

These are follow-ups, not done yet:

- **Privacy policy:** [privacy-policy.md](legal/privacy-policy.md) names OVHcloud as the server
  host. It must name the actual host (the University of Waterloo Computer Science Club) before
  real players' data goes there. The incident-response contacts need the same change.
- **Optional, a single-origin deploy:** today the web app lives on Cloudflare Pages and the
  API on `api.<domain>`. A small server change could serve the built web app from the same
  origin: static files plus a fallback to `index.html`, behind a setting such as
  `WEB_DIST_DIR`. Then one hostname and one tunnel route would serve both, and Pages would
  be optional. It isn't needed, since Pages is free.
- **Optional, release builds on GitHub Actions:** a workflow could run `package.sh` and attach
  the release file to each commit, so you wouldn't need Docker at home.
- **Optional, running behind CSC's own reverse proxy** (a `*.csclub.cloud` vhost) instead of
  Cloudflare: the server would need a "trust this proxy's forwarded-for header" mode, because
  `TRUST_CLOUDFLARE` assumes Cloudflare's header. Only worth it if the tunnel is ever blocked.

## What the scripts are (infra/csclub)

| File               | Runs on   | Does                                                                                                                              |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `package.sh`       | your PC   | Builds `dist/csclub/game-release-<commit>.tar.gz` from a commit, with the same Dockerfiles as the Docker deploy                    |
| `setup.sh`         | VM, once  | Creates `~/game`, the settings file with secrets, downloads the tools, creates the database                                       |
| `install.sh`       | VM        | Installs a release: migrations, draining restart, health check; `--rollback`; `--now`                                             |
| `start.sh`         | VM        | Starts whatever isn't running (also used by `@reboot`)                                                                            |
| `stop.sh`          | VM        | Stops the game (`--now`, `--all`) and pauses the watchdog                                                                         |
| `status.sh`        | VM        | Shows what runs, health, disk and the latest backup                                                                               |
| `watchdog.sh`      | VM, cron  | Restarts dead or unhealthy processes, backs off on crash loops, rotates logs, warns on low disk and missing backups (optional push alerts) |
| `backup.sh`        | VM, cron  | Encrypted dump; keeps 7 days locally; optional off-site upload with 30-day retention                                              |
| `restore.sh`       | VM        | Restores a backup and re-applies account deletions                                                                                |
| `game.env.example` | VM        | The settings template that `setup.sh` copies to `~/game/game.env`                                                                 |
| `crontab.example`  | VM        | The three cron jobs                                                                                                               |

Some safety details:

- Each process gets only the settings it needs. The bot engine and the tunnel never see the
  auth secrets, and the server never sees the tunnel token.
- Secrets stay off command lines, where other users of a shared machine could see them
  with `ps`.
- `~/game` is readable only by you, and the restore keeps the decrypted backup inside it.
- The database accepts connections only from 127.0.0.1, with a password.
- On a VM of your own, nobody else can reach the 127.0.0.1 ports. On a shared machine they
  can; see [If you only get a general-use machine](#if-you-only-get-a-general-use-machine).

## Sources

- CSC services overview (4 GB disk quota across all machines): <https://csclub.uwaterloo.ca/resources/services/>
- CSC cloud accounts: <https://csclub.uwaterloo.ca/resources/services/cloud-accounts/>
- CSC Cloud docs (CloudStack quotas, activation; vhosts): <https://docs.cloud.csclub.uwaterloo.ca/cloudstack/>,
  <https://docs.cloud.csclub.uwaterloo.ca/vhosts/> (unreachable when checked in October 2026; facts taken from search-engine copies)
- Machine Usage Agreement: <https://csclub.uwaterloo.ca/resources/machine-usage-agreement/>
- Membership ($2/term, open to alumni): <https://csclub.uwaterloo.ca/get-involved/>
- Cloud Gen 2 proposal (CloudStack failure, Proxmox plan): <https://wiki.csclub.uwaterloo.ca/Cloud_Gen_2>
- Machine list (general-use machines, User Cloud on Proxmox, "nice" long jobs): <https://wiki.csclub.uwaterloo.ca/Machine_List>
- Proxmox (how syscom creates member VMs and containers): <https://wiki.csclub.uwaterloo.ca/Proxmox>
- Cloud networking (private 172.19.134.0/24 user network, NAT): <https://wiki.csclub.uwaterloo.ca/Cloud_Networking>
- Campus firewall exceptions (general-use ports): <https://wiki.csclub.uwaterloo.ca/Firewall>
- Member PostgreSQL (`ceo postgresql create`): <https://wiki.csclub.uwaterloo.ca/PostgreSQL>
- Web hosting rules (no ads or commercial use; reverse proxy to high ports): <https://wiki.csclub.uwaterloo.ca/Web_Hosting>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Resend pricing: <https://resend.com/pricing>
