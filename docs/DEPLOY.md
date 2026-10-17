# Putting the game online

This guide takes the game from "runs on my computer" to "anyone can play at
`https://play.yourdomain.com`". It assumes no prior experience with servers. Each step says
what you are doing and why. Budget about two hours the first time. The costs and the reasons
behind each choice are in [PLAN.md §9](PLAN.md).

> **Before a public launch**, work through the "Before public release" list in
> [TODO.md](../TODO.md): attorney review of the legal documents, the business entity,
> the DMCA agent, upgrading Resend, and so on. You can follow this guide earlier for a
> private test with friends.

## How the pieces fit

```
 Player's browser
   │
   ├── https://play.yourdomain.com ──► Cloudflare Pages   (the web app: pictures, code, pages)
   │
   └── https://api.yourdomain.com  ──► Cloudflare ──tunnel──► your VPS
                                                               ├── server       (referee, lobbies, accounts)
                                                               ├── bot-service  (bot moves)
                                                               └── postgres     (the database)
```

- **Cloudflare Pages** serves the web app from data centres worldwide, for free.
- **Your VPS** (a rented always-on computer) runs the game server, the bots and the database,
  packed in Docker containers so they start with one command.
- **The Cloudflare Tunnel** connects the VPS to Cloudflare from the inside out. The VPS
  therefore needs no open web ports and no security certificates, and attackers can't reach it
  directly. Cloudflare also adds free DDoS protection.

## Step 1: Accounts to create (about 30 minutes)

| Account                                                                                                           | What it's for                                                                 | Cost                                |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Domain name (Cloudflare Registrar, or any registrar)                                                              | Your address, e.g. `yourdomain.com`                                           | ≈ $10–15/year                       |
| [Cloudflare](https://dash.cloudflare.com/sign-up)                                                                 | DNS, web hosting (Pages), the tunnel, Turnstile CAPTCHA                       | Free                                |
| [OVHcloud US](https://us.ovhcloud.com/vps/)                                                                       | The VPS: choose 4 vCPU / 8 GB RAM, region US-East (Virginia), OS Ubuntu 24.04 | ≈ $9–15/month                       |
| [Resend](https://resend.com)                                                                                      | Sends verification and password-reset emails                                  | Free tier, Pro $20/mo before launch |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) or [Backblaze B2](https://www.backblaze.com/cloud-storage) | Off-site database backups                                                     | Free tier / ≈ $1/month              |

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

## Step 3: Set up the VPS (about 20 minutes)

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

## Step 6: Nightly backups (about 15 minutes)

On the VPS:

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
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm --no-deps server \
  node apps/server/src/jobs/reapply-deletions-cli.ts
docker compose -f infra/docker-compose.yml --env-file infra/.env start server
```

(`game` is the default `DB_USER` and `DB_NAME`; use yours if you changed them.) The
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
