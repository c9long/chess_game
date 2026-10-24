# Putting the game online

This guide takes the game from "runs on my computer" to "anyone can play at
`https://play.yourdomain.com`". It assumes no prior experience with servers. Each step says
what you are doing and why. Budget about two hours the first time. The costs and the reasons
behind each choice are in [PLAN.md §9](PLAN.md).

**What it costs:** $0 a month on the free tiers below (Oracle Cloud's free ARM server,
Cloudflare, Resend, R2), plus the domain name, about $10–15 a year. The paid alternative for
the server is an OVHcloud VPS (about $9–15 a month), with the same steps after step 3.

> **No domain or email service yet?** [DEPLOY-BETA.md](DEPLOY-BETA.md) is a true $0 beta: a free
> DuckDNS address, sign-in with Google, Discord or GitHub only, and no Cloudflare in front.

> **Before charging money or a public launch**, work through the "Before public release" list
> in [TODO.md](../TODO.md): attorney review of the legal documents, the business entity, the
> DMCA agent and so on. A free beta with no ads or payments can run before that (decided
> 2026-10-24).

## How the pieces fit

```
 Player's browser
   │
   ├── https://play.yourdomain.com ──► Cloudflare Pages   (the web app: pictures, code, pages)
   │
   └── https://api.yourdomain.com  ──► Cloudflare ──tunnel──► your server
                                                               ├── server       (referee, lobbies, accounts)
                                                               ├── bot-service  (bot moves)
                                                               └── postgres     (the database)
```

- **Cloudflare Pages** serves the web app from data centres worldwide, for free.
- **Your server** (an always-on computer in a data centre: Oracle Cloud's free one, or a
  rented VPS) runs the game server, the bots and the database, packed in Docker containers so
  they start with one command.
- **The Cloudflare Tunnel** connects the server to Cloudflare from the inside out. The server
  therefore needs no open web ports and no security certificates, and attackers can't reach it
  directly. Cloudflare also adds free DDoS protection.

## Step 1: Accounts to create (about 30 minutes)

| Account                                                                                                           | What it's for                                                                 | Cost                                |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Domain name (Cloudflare Registrar, or any registrar)                                                              | Your address, e.g. `yourdomain.com`                                           | ≈ $10–15/year                       |
| [Cloudflare](https://dash.cloudflare.com/sign-up)                                                                 | DNS, web hosting (Pages), the tunnel, Turnstile CAPTCHA                       | Free                                |
| [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) | The server: an "Always Free" ARM machine (2 cores, 12 GB). Pick **US East (Ashburn)** as the home region at sign-up; it can't be changed later | Free (a card is needed to verify you) |
| or [OVHcloud US](https://us.ovhcloud.com/vps/) | A paid VPS instead: 4 vCPU / 8 GB RAM, US-East (Virginia), Ubuntu 24.04 | ≈ $9–15/month |
| [Resend](https://resend.com) | Sends verification and password-reset emails | Free: 100 emails a day, 3,000 a month (Pro, $20/mo, only if you outgrow it) |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) or [Backblaze B2](https://www.backblaze.com/cloud-storage) | Off-site database backups                                                     | Free tier / ≈ $1/month              |
| [Sentry](https://sentry.io) (optional, step 7) | Error reports from the server and players' browsers, plus an uptime check | Free (Developer plan) |

If you bought the domain elsewhere, add it to Cloudflare ("Add a site") and change the
nameservers at your registrar to the two Cloudflare shows you. This hands the domain's
"phone book" (DNS) to Cloudflare.

## Step 2: Prepare the keys and secrets (about 15 minutes)

You'll paste these into one settings file in step 4.

1. **Turnstile** (the invisible "are you human?" check): Cloudflare dashboard → Turnstile →
   Add widget → hostname `play.yourdomain.com`. Copy the **site key** and **secret key**.
2. **Resend**: add and verify your domain (Resend shows DNS records; add them in Cloudflare →
   DNS). Create an **API key**. Your sender address will be something like
   `no-reply@yourdomain.com`.
3. **Cloudflare Tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a
   tunnel → type "Cloudflared" → name it `game`. On the install screen, copy the **token**
   (the long string after `--token`). Then add a **Public hostname**: subdomain `api`, domain
   `yourdomain.com`, service type `HTTP`, URL `server:3000`. Cloudflare creates the DNS record
   for `api.yourdomain.com` for you.
4. **Random secrets**: on any Linux or macOS terminal, run `openssl rand -hex 32` three times.
   They are for the database password, `BETTER_AUTH_SECRET` and `IP_HASH_SECRET`. Store them in
   a password manager.
5. **OAuth (optional)**: to show "Sign in with Google/Discord/GitHub/Microsoft", create an app
   with each provider and use the redirect URL
   `https://api.yourdomain.com/api/auth/callback/<provider>` (e.g. `.../callback/google`).
   Providers you skip stay hidden.

## Step 3: Set up the server (about 20 minutes)

### On Oracle Cloud (free)

1. In the Oracle Cloud console: **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 24.04 (the plain one, not "Minimal").
   - **Shape:** Change shape → Ampere → `VM.Standard.A1.Flex`. Drag the sliders to the most
     the free allowance allows: **2 OCPUs and 12 GB memory** since mid-2026 (it was 4 and 24
     before). It says "Always Free-eligible". If the sliders stop at 1 OCPU and 6 GB, take that:
     it runs the game, just with fewer bot games at once. Set `BOT_CPUS` in `infra/.env` to `1`
     for 2 OCPUs or `0.5` for 1 OCPU, so the bots leave room for the game server.
   - **Security:** leave everything off (Shielded instance, Confidential computing). The game
     doesn't need them, and they aren't available on every free shape.
   - **Networking:** keep the new virtual cloud network it offers, with a public IPv4 address.
   - **SSH keys:** upload your public key (`~/.ssh/id_ed25519.pub`; make one with
     `ssh-keygen -t ed25519` if you have none).
   - **Boot volume:** 100 GB is plenty (up to 200 GB is free).
2. If it says **"Out of capacity"**, Ashburn has no free ARM machines at that moment: try
   another availability domain in the same form, or try again later (often at night).
3. **Keep it from being reclaimed.** Oracle may take back free machines that sit idle for a
   week, which a quiet game server can look like. Upgrading the account to **Pay As You Go**
   (Billing → Upgrade) stops that. Free-tier resources still cost $0; set a budget alert of $1
   (Billing → Budgets) so anything that isn't free is caught at once.
4. Leave the firewall alone. Oracle's network only lets SSH in (port 22), and its Ubuntu image
   has its own firewall rules, so **skip `infra/firewall.sh` on Oracle** (it refuses to run
   there). Game traffic arrives through the tunnel and needs no open port.

Then log in with the public IP address the instance page shows and install Docker:

```sh
ssh ubuntu@YOUR_SERVER_IP                     # log in to the server

sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

sudo mkdir -p /opt/game && sudo chown ubuntu /opt/game
git clone https://github.com/c9long/chess_game.git /opt/game
```

Everything in the game builds for ARM; CI starts the whole stack on an ARM machine on every
change.

### On an OVHcloud VPS (paid)

OVHcloud emails you the server's IP address and login. From your computer's terminal:

```sh
ssh ubuntu@YOUR_SERVER_IP                     # log in to the server

# Updates, Docker (runs the containers) and a firewall that only allows SSH.
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# The game code.
sudo mkdir -p /opt/game && sudo chown ubuntu /opt/game
git clone https://github.com/c9long/chess_game.git /opt/game
sudo /opt/game/infra/firewall.sh
```

The firewall script blocks every incoming connection except SSH. Game traffic arrives through
the tunnel, so nothing else needs to be open.

## Step 4: Fill in the settings and start (about 15 minutes)

```sh
cd /opt/game
cp infra/.env.example infra/.env
nano infra/.env           # paste the values from step 2; Ctrl-O to save, Ctrl-X to exit
```

Leave the line `COMPOSE_PROFILES=tunnel` in place: it is what starts the Cloudflare Tunnel
container. (Without it you get the server, bots and database but no public address, which is
only useful for the local test below.)

Then start everything. The first run builds the containers, which takes about 10 minutes:

```sh
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml --env-file infra/.env ps     # server "healthy"?
```

`migrate` shows as "exited (0)": it applies database changes and stops, which is expected.

The server refuses to start if a production setting is missing or unsafe, and the log says
which one: `docker compose -f infra/docker-compose.yml logs server`.

Check: `https://api.yourdomain.com/api/health` should answer with `"status":"ok"`.

## Step 5: The web app on Cloudflare Pages (about 15 minutes)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → "Upload assets" → name the
   project (for example `game-web`) → create it with any placeholder file. Then Custom domains
   → add `play.yourdomain.com`.
2. Cloudflare → My Profile → API Tokens → Create token with the permission
   **Account · Cloudflare Pages · Edit**. Copy it, plus your **Account ID** (shown on the
   Workers & Pages overview).
3. On GitHub, open the repository → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `VITE_API_URL` = `https://api.yourdomain.com`, `PAGES_PROJECT` = `game-web`
4. Actions tab → "Deploy web" → Run workflow. From now on, every push to `main` redeploys
   the web app automatically.

Open `https://play.yourdomain.com`. You should see the date-of-birth screen.

> **Alternative: one hostname, no Pages.** The server can also serve the built web app itself
> when `WEB_DIST_DIR` points at a web build (made with `pnpm --filter @game/web build` and no
> `VITE_API_URL`); then `API_PUBLIC_URL` and `WEB_ORIGIN` are the same address and one tunnel
> route serves both (see `apps/server/.env.example`). The server image's `with-web` target
> includes that build; [DEPLOY-BETA.md](DEPLOY-BETA.md) uses it. With a domain, Pages stays the
> simple way.

## Step 6: Nightly backups (about 15 minutes)

On the server:

```sh
sudo apt -y install age rclone
age-keygen -o ~/backup-key.txt     # prints "Public key: age1..."
```

- Put the **public key** (`age1...`) in `infra/.env` as `BACKUP_AGE_RECIPIENT`.
- **Copy `~/backup-key.txt` to your password manager, then delete it from the server.** It is
  the only way to read the backups. Keeping it off the server means a stolen server can't
  decrypt them.
- Run `rclone config` and create a remote named `r2` (or `b2`) with your storage credentials.
  Set `BACKUP_REMOTE` to `r2:<bucket-name>`.
- Test the dump and your key first, without uploading anything:
  `/opt/game/infra/backup.sh --dry-run` writes `game-<date>.sql.gz.age` to the current
  folder. Delete that file afterwards.
- Test the real thing: `/opt/game/infra/backup.sh`. Then schedule it nightly with
  `crontab -e`:
  `15 3 * * * /opt/game/infra/backup.sh >> /home/ubuntu/backup.log 2>&1`
- The nightly run deletes backups older than `BACKUP_RETENTION_DAYS` (30) from the remote. It
  only touches its own `game-*.sql.gz.age` files.

## Step 7: Error reports and uptime checks (optional, about 20 minutes)

Two free safety nets. **Error reports** tell you when the game breaks for someone: Sentry
collects crashes from the server and from players' browsers, with the line of code that
failed. An **uptime check** visits the server every few minutes and emails you when it stops
answering, so you hear about an outage before the players tell you. Both stay off until you
add the settings below, and the game works the same without them.

Privacy: before a report leaves the server or the browser, the game removes who it was about
(no account, username, email or IP address) and anything that could hold a password or a
sign-in code (cookies, request contents, links with codes in them). The details are in
`packages/config/src/error-scrub.ts`.

**Sentry (error reports):**

1. Sign up at [sentry.io](https://sentry.io) and pick the **US** data region (it can't be
   changed later). The free **Developer** plan is enough: it has a monthly allowance of error
   reports and one uptime monitor (current limits on [sentry.io/pricing](https://sentry.io/pricing/)).
   It has no card on file, so it can never charge you; past the allowance, reports are simply
   dropped until the next month.
2. Create two projects in the same organization: one with the platform **Node.js** (for
   example `game-server`) and one with **Browser JavaScript** (`game-web`). Skip the setup
   instructions Sentry shows: the code is already in place.
3. In **each** project: Settings → Security & Privacy → turn on **Prevent Storing of IP
   Addresses**, and leave **Data Scrubber** and **Use Default Scrubbers** on. This is a second
   lock behind the game's own scrubbing.
4. Each project has a **DSN**, an address that looks like
   `https://abc123@o123456.ingest.us.sentry.io/789` (project Settings → Client Keys (DSN)). A
   DSN only lets someone send reports, so it isn't a secret.
   - The **server** project's DSN goes in `infra/.env` as `SENTRY_DSN`. Then restart:
     `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`. The server's
     start-up line in the log now says `"errorTracking":"production"` instead of `"off"`.
   - The **web** project's DSN goes on GitHub: repository → Settings → Secrets and variables
     → Actions → Variables → New variable `VITE_SENTRY_DSN`. Then Actions → "Deploy web" →
     Run workflow. The web app loads Sentry only after the page has finished loading, so it
     doesn't slow the first visit.
   - Only if the server serves the web app itself (the "one hostname" alternative in step 5):
     build the web app with `VITE_SENTRY_DSN` set, and put the same value in `infra/.env` as
     `VITE_SENTRY_DSN` too. The server then lets the page send reports to Sentry (its
     Content-Security-Policy blocks every other site).

The server reports every line it logs at the error level (at most 30 reports an hour, 5 of the
same kind), so a client sending junk can't use up the monthly allowance.

**Uptime check** on `https://api.yourdomain.com/api/health`. That address answers
`"status":"ok"` when the server and its database are fine, and an error (503) when the database
is unreachable; both services below count an error or no answer as "down". Pick one:

- **Sentry** (if you set it up above): Alerts → Create Alert → **Uptime Monitor** (in some
  versions under Insights → Uptime). Enter the address, keep the method GET, and choose who
  gets the email.
- **[Better Stack](https://betterstack.com/uptime)** free plan: Monitors → Create monitor →
  "URL becomes unavailable", paste the address, and set your email for alerts.

(UptimeRobot's free plan is for non-commercial use only, so it doesn't fit a game that may
earn money later.) If the check reports "403 Forbidden" while the game works in your browser,
Cloudflare's bot protection is stopping the checker: in Cloudflare → Security, turn off **Bot
Fight Mode**, or add a rule that skips it for the path `/api/health`.

## Later: the Android and iOS apps

Not needed for the website. When the mobile apps ([MOBILE.md](MOBILE.md)) are being tested:

1. In `infra/.env` set `NATIVE_ORIGINS=capacitor://localhost,https://localhost` (the iOS and
   Android app origins), then restart: `docker compose -f infra/docker-compose.yml --env-file
   infra/.env up -d`. Left empty (the default), the server behaves exactly as before.
2. Build the bundle the apps load: `VITE_API_URL=https://api.yourdomain.com pnpm --filter
   @game/web build:native` (output in `apps/web/dist-native`).

The apps will sign in through the website's device-approval page and then use a bearer token,
so Turnstile, OAuth and passkeys need no changes for them (the app's own sign-in screen is
still to come; until then a native build shows a placeholder instead of the web forms). The
server answers the app origins with CORS but without credentials, so no cookie session can be
made from them.

## Updating the game

```sh
cd /opt/game && git pull
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

The server stops opening new lobbies and lets running games finish (up to 45 minutes)
before it restarts, so players don't lose games mid-match. Schedule updates for quiet hours.

To roll back, check out the previous version (`git checkout <commit>`) and run the same
`up -d --build`. The images always rebuild the rules engine and bots from the checked-out
code, so an older checkout really gives you the older engine.

### PostgreSQL extensions

Player search (Friends page) uses the `pg_trgm` extension. Migration 0011 runs `CREATE
EXTENSION IF NOT EXISTS pg_trgm` and adds a trigram index on usernames. `pg_trgm` ships with
PostgreSQL's contrib modules, which the `postgres:16-alpine` image includes, and it is a
"trusted" extension (PostgreSQL 13 and later), so the database owner can create it without
superuser rights. A managed database (or the CSC's `ceo postgresql` one) must allow it: check
with `SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';`.

If it isn't available, the migration still succeeds: it creates a plain prefix index
(`lower(username) text_pattern_ops`) instead, and search matches only the start of usernames
(no fuzzy matches). The server checks for the extension at the first search after it starts.
To get fuzzy search later, install the extension and then, in `psql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS users_username_trgm_idx ON users
  USING gin (lower(username) gin_trgm_ops) WHERE username IS NOT NULL;
DROP INDEX IF EXISTS users_username_prefix_idx;
VACUUM ANALYZE users;
```

and restart the server. The trigram index only gets used once `VACUUM` (or autovacuum, soon
after the migration) has filled in its statistics; until then searches fall back to scanning
the table, which is still fine at a few thousand players.

## Restoring a backup

```sh
rclone copy r2:<bucket>/game-<date>.sql.gz.age .
age -d -i backup-key.txt game-<date>.sql.gz.age | gunzip > restore.sql
docker compose -f infra/docker-compose.yml --env-file infra/.env stop server
# A dump restores into an EMPTY database: recreate it first (this deletes the current data).
docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres \
  dropdb -U game --force game
docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres \
  createdb -U game game
docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres \
  psql -q -U game -d game -v ON_ERROR_STOP=1 < restore.sql
# Apply database changes from updates made after the backup (only the missing ones).
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm migrate
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm --no-deps server \
  node apps/server/src/jobs/reapply-deletions-cli.ts
docker compose -f infra/docker-compose.yml --env-file infra/.env start server
```

(`game` is the default `DB_USER` and `DB_NAME`; use yours if you changed them.) The
`migrate` step matters when the backup is older than the running version: without it the
server would find tables from before the update. The
`reapply-deletions` step matters: it deletes again any account that was deleted after
the backup was taken (a privacy-law requirement). Practise a restore once before launch, as
TODO.md asks. A backup you have never restored is a hope, not a backup.

## Trying the stack locally (optional)

You can run the production containers on your own computer (Docker required) before renting
anything. It runs without the tunnel, under a separate project name (`gametest`), so it
never touches other containers.

```sh
mkdir -p ~/gametest
grep -v '^COMPOSE_PROFILES=' infra/.env.example > ~/gametest/test.env
# In ~/gametest/test.env set: DB_PASSWORD, BETTER_AUTH_SECRET and IP_HASH_SECRET to
# `openssl rand -hex 32` values; TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and RESEND_API_KEY
# to any placeholder text. GAME_ENV_FILE tells the server container to read this file
# instead of infra/.env.
export GAME_ENV_FILE=~/gametest/test.env
docker compose -p gametest -f infra/docker-compose.yml -f infra/docker-compose.local.yml \
  --env-file "$GAME_ENV_FILE" up -d --build --wait
curl http://127.0.0.1:3900/api/health          # {"status":"ok","db":"ok"}
docker compose -p gametest -f infra/docker-compose.yml -f infra/docker-compose.local.yml \
  --env-file "$GAME_ENV_FILE" down -v           # stop and delete the test data
```

The server runs in production mode, so signing in won't work with placeholder Turnstile
keys; the point is to check that everything builds, migrates and starts.

## If something goes wrong

| Symptom                                | Where to look                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.yourdomain.com` doesn't answer    | `docker compose ... ps` (all running?) and `docker compose ... logs cloudflared`                                                                             |
| Server keeps restarting                | `docker compose ... logs server`: the first error line names the missing or unsafe setting                                                                   |
| No verification emails                 | Resend dashboard → Logs. Is the domain verified? The free tier allows 100 emails per day                                                                     |
| Bots play weak or random-looking moves | `docker compose ... logs bot-service`: when it is down, the server falls back to simple moves (still paced by `BOT_MIN_MOVE_MS`, so they don't look instant) |
| Signing in fails on the live site      | `WEB_ORIGIN`, `API_PUBLIC_URL` and `PASSKEY_RP_ID` must match your real domains exactly                                                                      |
| The mobile app can't reach the server  | `NATIVE_ORIGINS` must list `capacitor://localhost,https://localhost`, and the app must be built with `build:native` and the real `VITE_API_URL`               |
