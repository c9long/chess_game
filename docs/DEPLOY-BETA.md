# The free beta: online for $0

This guide puts the game online for **$0**: no domain to buy and no email service. Players open
`https://yourname.duckdns.org`. They play as guests, or create an account with Google, Discord
or GitHub. It assumes no prior experience with servers. Budget about two hours.

The full setup, with your own domain, email accounts and Cloudflare in front, is in
[DEPLOY.md](DEPLOY.md). Moving to it later is covered at the end.

## What you give up for $0

| Missing                                      | What it means for players                                                                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An email service (it needs a domain you own) | No email-and-password accounts and no password reset. Accounts are created with Google, Discord or GitHub; guests play without one. Passkeys and two-step verification still work.                                                                 |
| Your own domain                              | The address is `yourname.duckdns.org`. When you move to a real domain, passkeys stop working (each is tied to an address), everyone signs in once more, and old links break. Accounts, ratings and history all stay, because they live in the database. |
| Cloudflare in front of the server            | No Cloudflare DDoS protection or CDN. The server answers players directly. Fine for a beta.                                                                                                                                                       |

The game turns email sign-up off itself (`EMAIL_ACCOUNTS=false`): the Create account page shows
only the Google, Discord and GitHub buttons.

## How the pieces fit

```
 Player's browser
   │
   └── https://yourname.duckdns.org ──► your Oracle server (ports 80/443)
                                          ├── caddy        (HTTPS certificate, front door)
                                          ├── server       (web pages, referee, lobbies, accounts)
                                          ├── bot-service  (bot moves)
                                          └── postgres     (the database)
```

- **Oracle Cloud's Always Free server** runs everything, packed in Docker containers so it all
  starts with one command.
- **DuckDNS** gives the server a free name that points at its address.
- **Caddy** gets a free HTTPS certificate (from Let's Encrypt) for that name and renews it on its
  own. It passes everything to the game server, which serves the web app as well as the game.

## Step 1: Accounts to create (about 30 minutes)

| Account                                                                                                                                                                                | What it's for                                                                                                                            | Cost                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)                                                                                                                           | The server (2 cores, 12 GB) and the backup storage.   Pick **US East (Ashburn)** as the home region at sign-up. It can't be changed later. | Free (a card verifies who you are) |
| [DuckDNS](https://www.duckdns.org)                                                                                                                                                     | The free address. Sign in with GitHub or Google.                                                                                         | Free                              |
| Cloudflare (you have one)                                                                                                                                                              | Turnstile, the invisible "are you human?" check                                                                                          | Free                              |
| [Google](https://console.cloud.google.com/apis/credentials), [Discord](https://discord.com/developers/applications), [GitHub](https://github.com/settings/developers) developer accounts | "Continue with …" sign-in, the only way to create an account. Set up at least one.                                                       | Free                              |
| [Sentry](https://sentry.io) (optional, step 8)                                                                                                                                         | Error reports and an uptime check                                                                                                        | Free                              |

## Step 2: The server on Oracle Cloud (about 20 minutes)

1. Create the machine as described in [DEPLOY.md step 3, "On Oracle Cloud (free)"](DEPLOY.md#on-oracle-cloud-free):
   - Ubuntu 24.04 on `VM.Standard.A1.Flex`, with 2 OCPUs and 12 GB (1 OCPU and 6 GB also
     works). Set `BOT_CPUS` to match in step 5;
   - **Security:** leave everything off;
   - what to do if it says "Out of capacity";
   - **upgrade to Pay As You Go, with a $1 budget alert**, so Oracle doesn't take back an idle
     free machine. Free resources still cost $0.
2. **Open the web ports.** Oracle's network only lets SSH in at first. Instance page → the
   subnet link → its **Security List** → **Add Ingress Rules**. Add two rules, both with source
   CIDR `0.0.0.0/0` and IP protocol TCP: one for destination port `80`, one for `443`.
   - Caddy needs port 80 to get its certificate, and redirects plain visits to HTTPS.
   - Skip `infra/firewall.sh` on Oracle; it refuses to run there.
3. Log in with the public IP address shown on the instance page, then install Docker and the
   code:

```sh
ssh ubuntu@YOUR_SERVER_IP

sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

sudo mkdir -p /opt/game && sudo chown ubuntu /opt/game
git clone https://github.com/c9long/chess_game.git /opt/game
```

## Step 3: The free address (about 5 minutes)

On [duckdns.org](https://www.duckdns.org), type a name in **sub domain** (for example
`mygame`), click **add domain**, then put the server's public IP in **current ip** and click
**update ip**. The address is now `mygame.duckdns.org`; this guide calls it
`yourname.duckdns.org`.

The IP stays the same while the instance exists, even across restarts. If you ever recreate the
instance, enter the new IP here.

## Step 4: Keys and secrets (about 20 minutes)

You'll paste these into one settings file in step 5.

1. **Turnstile:** Cloudflare dashboard → Turnstile → Add widget → hostname
   `yourname.duckdns.org`. Copy the **site key** and the **secret key**.
2. **Random secrets:** run `openssl rand -hex 32` three times, on the server or any Linux or
   macOS terminal. They are the database password, `BETTER_AUTH_SECRET` and `IP_HASH_SECRET`.
   Keep them in a password manager.
3. **Sign-in apps.** Create at least one, because nobody can create an account without one.
   Every redirect (callback) URL has the form
   `https://yourname.duckdns.org/api/auth/callback/<provider>`.
   - **Google:** Google Cloud console → APIs & Services.
     1. OAuth consent screen: type "External", app name and support email, no logo (a logo
        means a review), then **Publish app**. While it says "Testing", only listed test
        users can sign in.
     2. Credentials → Create credentials → OAuth client ID → "Web application", with
        authorized redirect URI `.../callback/google`.
     3. Copy the client ID and secret.
   - **Discord:** Developer Portal → New Application → OAuth2 → add redirect
     `.../callback/discord`. Copy the client ID and secret.
   - **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App.
     1. Homepage `https://yourname.duckdns.org`, callback `.../callback/github`.
     2. Generate a client secret, then copy the client ID and secret.

## Step 5: Fill in the settings and start (about 15 minutes)

```sh
cd /opt/game
cp infra/beta.env.example infra/.env
nano infra/.env           # paste the values from step 4; Ctrl-O to save, Ctrl-X to exit
```

Replace `yourname.duckdns.org` everywhere in the file with your address.

Then start everything. The first run builds the containers, which takes 10–15 minutes:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.beta.yml \
  --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.beta.yml \
  --env-file infra/.env ps                     # server "healthy", caddy "running"?
```

`migrate` shows as "exited (0)": it applies database changes and stops, which is expected.

Open `https://yourname.duckdns.org`. You should see the date-of-birth screen.

- The first visit can take up to a minute while Caddy gets the certificate.
- `https://yourname.duckdns.org/api/health` should answer `"status":"ok"`.

Then play a guest game against bots, and create an account with each sign-in button you set up.

**Every command for this setup lists both files**, `-f infra/docker-compose.yml -f
infra/docker-compose.beta.yml`. This includes the update, restart and restore commands in
DEPLOY.md, which show only the first. Leaving out the second starts the server without Caddy
and without the web app.

## Step 6: Updating the game

```sh
cd /opt/game && git pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.beta.yml \
  --env-file infra/.env up -d --build
```

Running games finish first, up to 45 minutes, before the server restarts. Rolling back works as
in [DEPLOY.md, "Updating the game"](DEPLOY.md#updating-the-game).

## Step 7: Nightly backups to Oracle's free storage (about 20 minutes)

Oracle's Always Free tier includes 20 GB of Object Storage, which is plenty for the database
backups. The backups are encrypted before they leave the server.

1. Oracle console → Storage → **Buckets** → Create bucket, named `game-backups`. Keep the
   defaults: private, Standard tier.
2. Note your **namespace**, shown on the bucket's page (a short string like `axk3q9z1abcd`).
3. Profile (top right) → your user → **Customer secret keys** → Generate secret key. Copy the
   key shown; it is shown only once. Then copy the **Access key** from the list.
4. On the server:

```sh
sudo apt -y install age rclone
age-keygen -o ~/backup-key.txt     # prints "Public key: age1..."
rclone config create oci s3 provider Other \
  access_key_id YOUR_ACCESS_KEY secret_access_key YOUR_SECRET_KEY \
  endpoint https://YOUR_NAMESPACE.compat.objectstorage.us-ashburn-1.oraclecloud.com \
  region us-ashburn-1 no_check_bucket true
rclone ls oci:game-backups         # no output and no error = connected
```

5. Finish the setup:
   - Put the **public key** (`age1...`) in `infra/.env` as `BACKUP_AGE_RECIPIENT`.
     `BACKUP_REMOTE=oci:game-backups` is already set.
   - **Copy `~/backup-key.txt` to your password manager, then delete it from the server.** It
     is the only way to read the backups. A stolen server can't decrypt them without it.
   - Test without uploading: `/opt/game/infra/backup.sh --dry-run`. Delete the file it writes.
   - Run it for real: `/opt/game/infra/backup.sh`. Then schedule it nightly with
     `crontab -e`:
     `15 3 * * * /opt/game/infra/backup.sh >> /home/ubuntu/backup.log 2>&1`

The backups sit with the same provider as the server. That is fine for a beta, but it is not a
second building. Restoring is described in [DEPLOY.md, "Restoring a backup"](DEPLOY.md#restoring-a-backup):

- use `oci:game-backups` in place of `r2:<bucket>`;
- add `-f infra/docker-compose.beta.yml` to each command.

Practise a restore once.

## Step 8: Error reports and uptime checks (optional)

Follow [DEPLOY.md step 7](DEPLOY.md#step-7-error-reports-and-uptime-checks-optional-about-20-minutes),
with two differences:

- **The web project's DSN** goes in `infra/.env` as `VITE_SENTRY_DSN`, not on GitHub. The web
  app is built into the server image here. Then run the update command from step 6.
- **The uptime check** watches `https://yourname.duckdns.org/api/health`.

## Moving to a real domain later

1. Buy the domain and follow [DEPLOY.md](DEPLOY.md) from step 2 on the same server.
2. Stop this stack first:
   `docker compose -f infra/docker-compose.yml -f infra/docker-compose.beta.yml --env-file infra/.env down`.
   This keeps the data, as long as you don't add `-v`.
3. Add the new redirect URLs to each sign-in app.
4. Set `EMAIL_ACCOUNTS=true` (or remove the line) once Resend is set up.

The database carries over, so everyone keeps their account, rating and history. Players re-add
their passkeys and sign in once.

## Trying it on your own computer (optional)

With Docker installed, this runs the same containers on plain HTTP at `http://127.0.0.1:3901`,
under a separate project name (`gametest`), so it never touches other containers:

```sh
mkdir -p ~/gametest
cp infra/beta.env.example ~/gametest/test.env
# In ~/gametest/test.env set SITE_ADDRESS=:80; DB_PASSWORD, BETTER_AUTH_SECRET and
# IP_HASH_SECRET to `openssl rand -hex 32` values; the Turnstile keys to any placeholder text.
export GAME_ENV_FILE=~/gametest/test.env
docker compose -p gametest -f infra/docker-compose.yml -f infra/docker-compose.beta.yml \
  -f infra/docker-compose.beta-local.yml --env-file "$GAME_ENV_FILE" up -d --build --wait
curl http://127.0.0.1:3901/api/health          # {"status":"ok","db":"ok"}
docker compose -p gametest -f infra/docker-compose.yml -f infra/docker-compose.beta.yml \
  -f infra/docker-compose.beta-local.yml --env-file "$GAME_ENV_FILE" down -v
```

## If something goes wrong

| Symptom                                   | Where to look                                                                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The address doesn't load at all           | Does DuckDNS show the server's current IP? Are ports 80 and 443 in the Security List (step 2)? Then `docker compose ... logs caddy`                                                                                                              |
| Caddy's log says the certificate failed   | Port 80 must be reachable from the internet. If the Security List is right, the machine's own firewall may block it: `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save` |
| Server keeps restarting                   | `docker compose ... logs server`: the first error line names the missing or unsafe setting                                                                                                                                                      |
| "Continue with Google" fails with an error | The redirect URL in that provider's app must be exactly `https://yourname.duckdns.org/api/auth/callback/google`. Google: is the app published?                                                                                                 |
| Signing in fails in other ways            | `WEB_ORIGIN`, `API_PUBLIC_URL` and `PASSKEY_RP_ID` must all be your exact DuckDNS address                                                                                                                                                        |
| Bots play weak or random-looking moves    | `docker compose ... logs bot-service`                                                                                                                                                                                                           |
