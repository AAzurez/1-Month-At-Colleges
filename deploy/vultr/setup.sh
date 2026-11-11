#!/usr/bin/env bash
# Sets up CollegeExperience on a fresh Vultr Ubuntu 24.04 server.
# Run as root on the server:
#   REPO_URL=https://github.com/you/CollegeExperience.git DOMAIN=game.example.com bash setup.sh
# REPO_URL is optional if you already copied the project to /opt/collegeexperience.
# DOMAIN is optional; without it the game is served on plain http://<server-ip>/.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/collegeexperience}"
APP_USER="${APP_USER:-college}"
DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-}"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git ufw debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy (web server with automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating the $APP_USER user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> Getting the code"
if [[ -n "$REPO_URL" && ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
elif [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only || true
fi
if [[ ! -f "$APP_DIR/web/server.mjs" ]]; then
  echo "No project found in $APP_DIR. Set REPO_URL, or copy the folder there first (see README.md)." >&2
  exit 1
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Installing dependencies"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev"
for agent in "$APP_DIR"/agents/person*/; do
  sudo -u "$APP_USER" bash -c "cd '$agent' && npm install"
done

# A .env saved on Windows ends lines with \r, which would end up inside the keys. Strip it.
[[ -f "$APP_DIR/.env" ]] && sed -i 's/\r$//' "$APP_DIR/.env"
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "WARNING: $APP_DIR/.env is missing. Copy your .env (DATABASE_URL, CURSOR_API_KEY) there before starting." >&2
elif ! grep -q '^CURSOR_API_KEY=' "$APP_DIR/.env"; then
  echo "WARNING: no CURSOR_API_KEY in $APP_DIR/.env. The agents run the AI through your Cursor account and need it to reply." >&2
fi

# Where the agents keep their sessions and memory between restarts.
mkdir -p /var/lib/college-agents
chown "$APP_USER:$APP_USER" /var/lib/college-agents

echo "==> Creating services"
AGENT_BIN="$APP_DIR/agents/person1/node_modules/.bin/agent-sdk"
cat > /etc/systemd/system/college-agents.service <<UNIT
[Unit]
Description=CollegeExperience agents (Captain, Spark, Sage)
After=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
# "serve" is the SDK's command for running on your own server. It only listens on this machine.
ExecStart=$AGENT_BIN serve --dir $APP_DIR/agents --host 127.0.0.1 --port 3000 --state-root /var/lib/college-agents
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/college-web.service <<UNIT
[Unit]
Description=CollegeExperience game server
After=network-online.target college-agents.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
Environment=PORT=4000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node web/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

echo "==> Pointing Caddy at the game"
SITE="${DOMAIN:-:80}"
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
  encode gzip
  reverse_proxy 127.0.0.1:4000
}
CADDY

echo "==> Opening the firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable --now college-agents college-web
systemctl restart caddy

IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "Done. Open: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$IP}"
echo "Logs:   journalctl -u college-web -u college-agents -f"
echo "Update: cd $APP_DIR && git pull && systemctl restart college-agents college-web"
