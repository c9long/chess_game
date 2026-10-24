#!/usr/bin/env bash
# Locks the VPS down (run once as root). Web traffic reaches the game through the Cloudflare
# Tunnel, which connects outbound, so the only inbound port the server needs is SSH.
set -euo pipefail

# Oracle Cloud's Ubuntu images keep their own iptables rules (the InstanceServices chain the
# machine needs to boot and reach its metadata service), and Oracle warns against ufw there.
# Their network already allows only SSH, so there is nothing to do (docs/DEPLOY.md step 3).
if grep -qs InstanceServices /etc/iptables/rules.v4; then
  echo "This looks like an Oracle Cloud machine: skip this script (see docs/DEPLOY.md step 3)." >&2
  exit 1
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
ufw status verbose
