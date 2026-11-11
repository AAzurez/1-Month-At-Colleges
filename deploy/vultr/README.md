# Hosting CollegeExperience on Vultr

This puts the game server and the three agents on one Vultr server, behind Caddy (which adds HTTPS automatically if you have a domain).

## 1. Create the server

1. In the Vultr dashboard: **Deploy +** → **Cloud Compute** → **Shared CPU**.
2. Pick a location near you, **Ubuntu 24.04 LTS**, and the 2 GB RAM plan (1 GB is too tight for the agents).
3. Add your SSH key under **SSH Keys**, then **Deploy**.
4. Copy the server's IP address once it's running.

## 2. Get a Cursor API key for the agents

The agents run the AI (Grok) through your Cursor account. On your PC, `agent-sdk login` signed you in through a browser; a server can't do that, so it needs an API key:

1. Open the Cursor dashboard (cursor.com → Dashboard) and create an API key.
2. Add it to the `.env` you'll copy to the server as `CURSOR_API_KEY=...`.

## 3. Copy your settings over

From the project folder on your computer:

```
scp .env root@<server-ip>:/root/.env
scp -r solana/config.json solana/balances.json root@<server-ip>:/root/   # only if you ran npm run solana:setup
```

If the repo is private or you'd rather not use git, copy the whole project instead (skip `node_modules`):

```
rsync -av --exclude node_modules --exclude .git ./ root@<server-ip>:/opt/collegeexperience/
```

## 4. Run the setup script

```
ssh root@<server-ip>
curl -fsSLO https://raw.githubusercontent.com/<you>/CollegeExperience/main/deploy/vultr/setup.sh   # or scp it
REPO_URL=https://github.com/<you>/CollegeExperience.git bash setup.sh
mv /root/.env /opt/collegeexperience/.env
mv /root/config.json /root/balances.json /opt/collegeexperience/solana/ 2>/dev/null || true
chown -R college:college /opt/collegeexperience
systemctl restart college-agents college-web
```

Then open `http://<server-ip>/`.

### Optional: a domain with HTTPS

Point an `A` record (for example `game.yourdomain.com`) at the server IP, then run the script again with `DOMAIN=game.yourdomain.com`. Caddy fetches the certificate by itself.

## Day-to-day

| Task | Command |
|---|---|
| Watch logs | `journalctl -u college-web -u college-agents -f` |
| Deploy new code | `cd /opt/collegeexperience && git pull && systemctl restart college-agents college-web` |
| Set up the database tables | `cd /opt/collegeexperience && sudo -u college npm run db:setup` |
| Reset the game | `rm /opt/collegeexperience/web/state.json && systemctl restart college-web` |

## Good to know

- The game keeps **one shared save** (`web/state.json`), so everyone who opens the link plays the same Sam.
- The game server listens only on `127.0.0.1:4000`; Caddy is the only thing open to the internet (ports 80/443, plus SSH).
- The agents run with `agent-sdk serve` (the SDK's self-hosting command) on `127.0.0.1:3000`, keeping their sessions in `/var/lib/college-agents`. Check them with `journalctl -u college-agents -f`.
