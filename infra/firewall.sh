#!/usr/bin/env bash
# Locks the VPS down (run once as root). Web traffic reaches the game through the Cloudflare
# Tunnel, which connects outbound, so the only inbound port the server needs is SSH.
set -euo pipefail

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
ufw status verbose
