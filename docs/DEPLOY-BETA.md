# The free beta: online for $0

This guide puts the game online for **$0**: no domain to buy and no email service. Players open
`https://yourname.duckdns.org`, play as guests, or create an account with Google, Discord or
GitHub.

Every step is here, screen by screen. You need no prior experience with servers. Budget about
three hours the first time, most of it waiting for Oracle and for the first build.

The full setup, with your own domain, email accounts and Cloudflare in front, is in
[DEPLOY.md](DEPLOY.md). Moving to it later is covered at the end of this guide.

> Cloud consoles rename buttons now and then. If a label here doesn't match exactly, look for
> the closest one. The values to enter stay the same.

## What you give up for $0

| Missing                                      | What it means for players                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An email service (it needs a domain you own) | No email-and-password accounts, so no password reset either. Accounts are created with Google, Discord or GitHub, and guests play without one. Passkeys and two-step verification still work.                                                         |
| Your own domain                              | The address is `yourname.duckdns.org`. When you move to a real domain, passkeys stop working (each one is tied to an address), everyone signs in once more, and old links break. Accounts, ratings and history all stay, because they live in the database. |
| Cloudflare in front of the server            | There is no Cloudflare DDoS protection or CDN, so the server answers players directly. That is fine for a beta.                                                                                                                                       |

The game switches email sign-up off by itself (`EMAIL_ACCOUNTS=false`). The Create account page
then shows only the Google, Discord and GitHub buttons.

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

- **Oracle Cloud's Always Free server** runs everything. The parts are packed in Docker
  containers, so they all start with one command.
- **DuckDNS** gives the server a free name that points at its address.
- **Caddy** gets a free HTTPS certificate for that name from Let's Encrypt and renews it by
  itself. It passes everything on to the game server, which serves the web app as well as the
  game.

## What you need before starting

- **A terminal with `ssh`:** WSL, macOS Terminal, or Windows PowerShell.
- **A password manager:** for the secrets this guide creates.
- **A payment card:** Oracle uses it to verify who you are. Free resources are never charged.

---

## Step 1: Oracle Cloud account (about 15 minutes, plus waiting)

1. Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and click **Start for
   free**.
2. Fill in the form.
   - **Account type:** Individual.
   - **Cloud account name:** anything (it becomes part of your sign-in page).
   - **Home region:** **US East (Ashburn)**. It can't be changed later.
3. Verify your email address, set a password, and enter the card. Oracle places a small
   temporary hold on it and releases it.
4. Wait for the "Your account is ready" email. This can take from a few minutes to a few
   hours. Then sign in at [cloud.oracle.com](https://cloud.oracle.com).
5. **Upgrade to Pay As You Go.** Oracle may take back free machines that sit idle for a week,
   and a quiet game server can look idle. Paid accounts are exempt, and free resources still
   cost $0 on them.
   1. Menu (☰, top left) → **Billing & Cost Management** → **Upgrade and Manage Payment**.
   2. **Upgrade to Pay As You Go** → confirm. The upgrade can take a few hours to finish, and
      you can carry on meanwhile.
6. **Add a $1 budget alert,** so anything that isn't free is caught at once:
   1. Menu → **Billing & Cost Management** → **Budgets** → **Create Budget**.
   2. Fill in:
      - **Name:** `free-tier-guard`;
      - **Target compartment:** the root (your account name);
      - **Budget amount:** `1`;
      - **Threshold:** `1` percent of the budget, with your email address as the recipient.
   3. Click **Create**.

## Step 2: The network (about 5 minutes)

The server needs a network that the internet can reach. Oracle's wizard builds one in a single
go.

1. Menu → **Networking** → **Virtual cloud networks**. At the top left, check that the
   **Compartment** is your root compartment.
2. Click **Actions** (or **Start VCN Wizard**) → **Create VCN with Internet Connectivity** →
   **Start VCN Wizard**.
3. **VCN name:** `game-vcn`. Leave every other field at its default.
4. Click **Next** → **Create**. Wait for the green ticks, then click **View VCN**.

This creates a **public subnet** (named `public subnet-game-vcn`) and the internet gateway it
needs. You'll pick this subnet when you create the server.

**Open the web ports.** At first the network lets in only SSH (port 22), which is how you log
in. Players need ports 80 and 443.

1. On the `game-vcn` page, open **Security** (or **Security Lists**) → **Default Security List
   for game-vcn**.
2. **Security rules** (or **Ingress Rules**) → **Add Ingress Rules**. Fill in:
   - **Stateless:** unticked.
   - **Source type:** CIDR. **Source CIDR:** `0.0.0.0/0`. This means anyone.
   - **IP protocol:** TCP.
   - **Source port range:** empty.
   - **Destination port range:** `80,443`.
   - **Description:** `web`.
3. Click **Add Ingress Rules**.

Caddy uses port 80 to get its certificate, and it sends plain visits on to HTTPS.

## Step 3: An SSH key (about 2 minutes)

You log in to the server with a key pair instead of a password. Make one on your own computer,
in the terminal:

```sh
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519      # press Enter at each question
cat ~/.ssh/id_ed25519.pub                               # one line starting with ssh-ed25519
```

Keep this terminal open: you'll paste that line in the next step. Never share the file
**without** `.pub`; that is the private half.

## Step 4: The server (about 10 minutes, longer if Oracle is busy)

Menu → **Compute** → **Instances** → **Create instance**. Go through the form from top to
bottom.

**Name and placement**

- **Name:** `game`.
- **Compartment:** your root compartment.
- **Placement / Availability domain:** keep AD-1 for now. If creating fails with "Out of
  capacity", come back and try AD-2, then AD-3.

**Image and shape.** Pick the shape first, because it decides which images can run.

1. Click **Change shape** → **Ampere** → tick **VM.Standard.A1.Flex**.
2. Set **Number of OCPUs** to `2` and **Amount of memory (GB)** to `12`. That is the whole free
   allowance (Oracle cut it from 4 and 24 in mid-2026), and the shape is marked "Always
   Free-eligible".
   - If the sliders stop at 1 OCPU and 6 GB, take that. The game runs on it, just with fewer
     bot games at once and a slower first build.
3. Click **Select shape**.
4. Click **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04**. Take the plain one, not
   "Minimal". Oracle picks the ARM ("aarch64") build to match the shape. Click **Select
   image**.

**Security**

- Leave **Shielded instance** and **Confidential computing** off. The game doesn't need them,
  and the free shape doesn't support them.

**Networking**

- **Primary network:** **Select existing virtual cloud network** → `game-vcn`.
- **Subnet:** **Select existing subnet** → **public subnet-game-vcn**.
- **Automatically assign public IPv4 address:** on. If it warns "You must select a public
  subnet", the subnet above is the private one: pick the public one.
- Leave IPv6, the private IP address and the rest at their defaults.

**SSH keys**

- Choose **Paste public keys** and paste the `ssh-ed25519 ...` line from step 3.

**Storage**

- **Boot volume:** tick **Specify a custom boot volume size** and enter `100` GB. Up to 200 GB
  is free. Leave the performance and encryption options at their defaults.

Click **Create**.

- The instance turns from PROVISIONING to **RUNNING** in a minute or two.
- If you get **"Out of host capacity"**, Ashburn has no free ARM machines in that availability
  domain right now. Try the other availability domains, or try again later; nights and
  weekends are easier.
- On the instance page, copy the **Public IP address**. This guide calls it `YOUR_SERVER_IP`.

## Step 5: Log in and install Docker (about 10 minutes)

From your terminal:

```sh
ssh ubuntu@YOUR_SERVER_IP          # first time: type "yes" to trust the server
```

You are now typing on the server; the prompt says `ubuntu@game`. Run these one block at a time:

```sh
# Updates (if a purple screen asks about services to restart, press Enter).
sudo apt update && sudo apt -y upgrade

# Docker, which runs the game's containers.
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# The server's own firewall: Oracle's Ubuntu image also blocks ports 80 and 443 by itself.
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save

# The game code.
sudo mkdir -p /opt/game && sudo chown ubuntu /opt/game
git clone https://github.com/c9long/chess_game.git /opt/game
```

Then add a shortcut, so that every command below is short and always includes both settings
files:

```sh
echo "alias dc='docker compose -f /opt/game/infra/docker-compose.yml -f /opt/game/infra/docker-compose.beta.yml --env-file /opt/game/infra/.env'" >> ~/.bashrc
exit
```

Log in again (`ssh ubuntu@YOUR_SERVER_IP`), so that the Docker group and the `dc` shortcut take
effect. Check that Docker works: `docker run --rm hello-world` prints "Hello from Docker!".

## Step 6: The free address (about 5 minutes)

1. Go to [duckdns.org](https://www.duckdns.org) and sign in with GitHub or Google.
2. In **sub domain**, type a name (for example `mygame`), then click **add domain**.
3. In that row, put `YOUR_SERVER_IP` in **current ip** and click **update ip**.

Your address is now `mygame.duckdns.org`; this guide calls it `yourname.duckdns.org`.

The IP stays the same while the instance exists, even across restarts. If you ever recreate
the instance, put the new IP here.

## Step 7: Keys and secrets (about 30 minutes)

Collect these in your password manager. Step 8 puts them in the settings file.

**Random secrets.** On the server, run this three times and save each line:

```sh
openssl rand -hex 32
```

They are the database password, `BETTER_AUTH_SECRET` and `IP_HASH_SECRET`.

**Turnstile** (the invisible "are you human?" check):

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. **Widget name:** `game beta`. **Hostname:** add `yourname.duckdns.org`. **Widget mode:**
   Managed. **Pre-clearance:** No.
3. Click **Create**, then copy the **Site Key** and the **Secret Key**.

**Sign-in apps.** Set up at least one; with none, nobody can create an account. Each one asks
for a redirect (or callback) URL of this form:

`https://yourname.duckdns.org/api/auth/callback/<provider>`

**Google**

1. [console.cloud.google.com](https://console.cloud.google.com) → project picker (top left) →
   **New project** → name `game` → **Create**, then select it.
2. Menu → **APIs & Services** → **OAuth consent screen**. It may be called **Google Auth
   Platform**; click **Get started** if asked.
   - **App name:** the game's name. **User support email:** yours.
   - **Audience:** External.
   - **Contact information:** your email. Agree and **Create**.
   - Don't upload a logo: a logo makes Google review the app first.
3. **Audience** → **Publish app** → Confirm. While it says "Testing", only test users you list
   can sign in.
4. **Clients** (or **Credentials** → **Create credentials** → **OAuth client ID**):
   - **Application type:** Web application. **Name:** `game beta`.
   - **Authorized redirect URIs:** add
     `https://yourname.duckdns.org/api/auth/callback/google`.
   - Click **Create**, then copy the **Client ID** and the **Client secret**.

**Discord**

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New
   Application** → a name → **Create**.
2. **OAuth2** (left menu): copy the **Client ID**. Click **Reset Secret** and copy the secret.
3. **Redirects** → **Add Redirect** →
   `https://yourname.duckdns.org/api/auth/callback/discord` → **Save Changes**.

**GitHub**

1. GitHub → your picture → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth
   App**.
2. Fill in:
   - **Application name:** the game's name;
   - **Homepage URL:** `https://yourname.duckdns.org`;
   - **Authorization callback URL:** `https://yourname.duckdns.org/api/auth/callback/github`.
3. Click **Register application**. Copy the **Client ID**, click **Generate a new client
   secret**, and copy that too.

## Step 8: Fill in the settings (about 10 minutes)

On the server:

```sh
cd /opt/game
cp infra/beta.env.example infra/.env
nano infra/.env
```

`nano` is a simple editor: move with the arrow keys, save with Ctrl-O then Enter, and exit with
Ctrl-X. Set these lines:

| Line                                                           | Value                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SITE_ADDRESS`                                                 | `yourname.duckdns.org` (no `https://`)                                        |
| `API_PUBLIC_URL`, `WEB_ORIGIN`                                 | `https://yourname.duckdns.org`                                                |
| `PASSKEY_RP_ID`                                                | `yourname.duckdns.org`                                                        |
| `DB_PASSWORD`, `BETTER_AUTH_SECRET`, `IP_HASH_SECRET`          | the three random secrets, one each                                            |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                   | from Turnstile                                                                |
| `GOOGLE_…`, `DISCORD_…`, `GITHUB_…` `CLIENT_ID` and `CLIENT_SECRET` | from each sign-in app you made. Leave the others empty, and their buttons stay hidden |
| `BOT_CPUS`                                                     | `1` on a 2-OCPU server, `0.5` on a 1-OCPU server                              |

Leave everything else as it is. `EMAIL_ACCOUNTS=false` is what turns email sign-up off.

## Step 9: Start the game (about 15–40 minutes, mostly waiting)

```sh
dc up -d --build
```

The first run builds everything on the server. That takes about 15 minutes on 2 OCPUs and up to
40 on 1. Later updates are faster. Then check:

```sh
dc ps
```

- **server** should say "healthy", and **caddy**, **bot-service** and **postgres** "running" or
  "healthy".
- **migrate** says "exited (0)". It applies database changes and stops, which is expected.

Open `https://yourname.duckdns.org` in your browser.

- You should see the date-of-birth screen. The very first visit can take up to a minute while
  Caddy gets the certificate.
- `https://yourname.duckdns.org/api/health` should answer `{"status":"ok","db":"ok"}`.

Then test it as a player:

1. Play a guest game against bots, to the end.
2. Create an account with each sign-in button you set up.
3. Sign in again in a private window.

If the server doesn't become healthy, `dc logs server` shows why. The first error line names
the missing or wrong setting.

## Step 10: Nightly backups (about 20 minutes)

Oracle's free tier includes 20 GB of storage, plenty for database backups. The backups are
encrypted on the server before they leave it.

**The storage bucket**

1. Oracle console: Menu → **Storage** → **Buckets** → **Create bucket**. **Name:**
   `game-backups`. Keep the defaults (Standard tier, private) → **Create**.
2. Open the bucket and copy the **Namespace** shown on its page: a short string like
   `axk3q9z1abcd`.
3. Profile icon (top right) → your user name → **Customer secret keys** (under Resources or
   Tokens and keys) → **Generate secret key** → name `backups` → **Generate secret key**.
   Copy the key now; it is shown only once. Close the dialog, then copy the **Access key** from
   the list.

**On the server**

```sh
sudo apt -y install age rclone
age-keygen -o ~/backup-key.txt       # prints "Public key: age1..."
cat ~/backup-key.txt                 # copy ALL of it into your password manager
rm ~/backup-key.txt                  # then delete it from the server
```

The file you just copied is the only way to read the backups. Keeping it off the server means a
stolen server can't decrypt them.

Connect the bucket, replacing the three capitalised values:

```sh
rclone config create oci s3 provider Other \
  access_key_id YOUR_ACCESS_KEY secret_access_key YOUR_SECRET_KEY \
  endpoint https://YOUR_NAMESPACE.compat.objectstorage.us-ashburn-1.oraclecloud.com \
  region us-ashburn-1 no_check_bucket true
rclone ls oci:game-backups           # no output and no error = connected
```

Put the public key (`age1...`) in `infra/.env` as `BACKUP_AGE_RECIPIENT` (`nano
/opt/game/infra/.env`). `BACKUP_REMOTE=oci:game-backups` is already set.

**Test it, then schedule it**

```sh
cd ~ && /opt/game/infra/backup.sh --dry-run && rm game-*.sql.gz.age   # dump + encrypt only
/opt/game/infra/backup.sh                                             # the real thing
rclone ls oci:game-backups                                            # shows game-<date>.sql.gz.age
crontab -e                                                            # pick nano if asked
```

In the file that opens, add this line at the bottom, then save and exit:

```
15 3 * * * /opt/game/infra/backup.sh >> /home/ubuntu/backup.log 2>&1
```

The backup now runs every night at 03:15 (server time, UTC). It deletes backups older than 30
days, and only touches its own `game-*.sql.gz.age` files.

The backups sit with the same provider as the server. That is fine for a beta, but it isn't a
second building.

## Restoring a backup

Practise this once, so you know it works.

1. Copy your backup key from the password manager into `~/backup-key.txt` on the server.
2. Run the restore, replacing `<date>` with the backup you want (`rclone ls oci:game-backups`
   lists them):

```sh
cd ~
rclone copy oci:game-backups/game-<date>.sql.gz.age .
age -d -i backup-key.txt game-<date>.sql.gz.age | gunzip > restore.sql
dc stop server
# A dump restores into an EMPTY database: recreate it first (this deletes the current data).
dc exec -T postgres dropdb -U game --force game
dc exec -T postgres createdb -U game game
dc exec -T postgres psql -q -U game -d game -v ON_ERROR_STOP=1 < restore.sql
# Database changes from updates made after the backup, then re-delete deleted accounts.
dc run --rm migrate
dc run --rm --no-deps server node apps/server/src/jobs/reapply-deletions-cli.ts
dc start server
rm backup-key.txt restore.sql game-*.sql.gz.age
```

The `reapply-deletions` step matters. It deletes again any account that was deleted after the
backup was taken, which privacy law requires.

## Updating the game

```sh
cd /opt/game && git pull
dc up -d --build
```

The server stops opening new lobbies and lets running games finish, up to 45 minutes, before it
restarts. Schedule updates for quiet hours.

To roll back:

1. Run `git log --oneline` and pick the previous version.
2. Run `git checkout <commit>` with that version.
3. Run `dc up -d --build` again.

The images always rebuild from the checked-out code.

## Optional: error reports and an uptime check (about 20 minutes)

Two free safety nets. Error reports tell you when the game breaks for someone. An uptime check
emails you when the site stops answering. Before any report leaves the server or the browser,
the game strips who it was about, including account, username, email and IP address.

1. Sign up at [sentry.io](https://sentry.io) and pick the **US** data region. The free
   **Developer** plan is enough, and it has no card, so it can never charge you.
2. Create two projects: platform **Node.js** (name `game-server`) and **Browser JavaScript**
   (name `game-web`). Skip Sentry's setup instructions; the code is already in place.
3. In **each** project, Settings → **Security & Privacy**:
   - turn on **Prevent Storing of IP Addresses**;
   - leave the data scrubbers on.
4. Copy each project's **DSN** (Settings → Client Keys). It looks like
   `https://abc123@o123456.ingest.us.sentry.io/789`.
5. In `infra/.env`:
   - set `SENTRY_DSN` to the server project's DSN;
   - set `VITE_SENTRY_DSN` to the web project's DSN.
6. Run `dc up -d --build`.
7. **Uptime check:** in Sentry, Alerts → Create Alert → **Uptime Monitor**. Use the address
   `https://yourname.duckdns.org/api/health`, keep the method GET, and add your email.

## Moving to a real domain later

1. Buy the domain and follow [DEPLOY.md](DEPLOY.md) from step 2, on this same server.
2. Stop this setup first with `dc down`. Without `-v`, the data stays.
3. Add the new redirect URLs to each sign-in app.
4. Set `EMAIL_ACCOUNTS=true` (or remove the line) once Resend is set up.

The database carries over: everyone keeps their account, rating and history. Players add their
passkeys again and sign in once.

## If something goes wrong

| Symptom                                    | What to check                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Out of host capacity" when creating       | Try another availability domain, or again later (step 4)                                                                                                               |
| `ssh` says "Permission denied (publickey)" | The user is `ubuntu`, and the key pasted in step 4 must be the `.pub` line from this computer                                                                           |
| The address doesn't load at all            | Does DuckDNS show the current IP? Ingress rule for `80,443` (step 2)? The `iptables` lines (step 5)? Then `dc logs caddy`                                               |
| Caddy's log says the certificate failed    | Port 80 must be reachable from the internet: the same three checks as above                                                                                             |
| Server keeps restarting                    | `dc logs server`: the first error line names the missing or wrong setting                                                                                               |
| "Continue with Google" shows an error      | The redirect URL must be exactly `https://yourname.duckdns.org/api/auth/callback/google`, and the app must be published                                                  |
| Signing in fails in other ways             | `WEB_ORIGIN`, `API_PUBLIC_URL` and `PASSKEY_RP_ID` must all be your exact DuckDNS address                                                                               |
| Bots play weak or random-looking moves     | `dc logs bot-service`                                                                                                                                                   |
| `dc: command not found`                    | Log out and in again after step 5, or run the alias line from step 5 again                                                                                              |

## Trying it on your own computer (optional)

With Docker installed, this runs the same containers on plain HTTP at `http://127.0.0.1:3901`.
It uses a separate project name (`gametest`), so it never touches other containers.

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
