# Deploying plzbot.me

The same build runs in two modes. Pick based on how much of the fingerprint you want:

| | `PLZBOT_MODE=tls` (default) | `PLZBOT_MODE=http` |
|---|---|---|
| Who terminates TLS | **This process** (raw-socket front proxy, see `docs/TLS_CAPTURE.md`) | The platform's load balancer / CDN |
| TLS ClientHello, JA3, JA4 | ✅ | ❌ reported as `unavailable: tls_terminated_upstream` |
| HTTP/2 SETTINGS, header order | ✅ as sent by the client | Whatever the proxy re-emits (often HTTP/1.1, re-ordered headers) |
| Real client IP | Direct TCP peer | From `X-Forwarded-For` / platform header, **only if** you set `PLZBOT_TRUST_PROXY` |
| Browser-side signals (JS) | ✅ | ✅ |
| Needs | A VM with ports 80/443 and a hostname | Any Node/Docker PaaS |

For the educational purpose of this project, TLS mode on a cheap/free VM is the one worth
running — it's the only way to show visitors (and AI agents you point at it) their TLS
fingerprint. HTTP mode is the fallback for zero-ops hosting.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PLZBOT_MODE` | `tls` | `tls` or `http` |
| `PLZBOT_HOST` | `127.0.0.1` (tls) / `0.0.0.0` (http) | Bind address. Containers need `0.0.0.0`. |
| `PLZBOT_PORT` | `8443` (tls) / `8080` (http) | Public port. `PORT` (PaaS convention) is honored too. |
| `PLZBOT_HTTP_PORT` | `0` (off) | TLS mode only: plain-HTTP helper for ACME HTTP-01 challenges + redirect to https. Set `80` in production. |
| `PLZBOT_TLS_CERT` / `PLZBOT_TLS_KEY` | `certs/dev-*.pem` | PEM paths. Renewed files are hot-reloaded (polled every 60 s). |
| `PLZBOT_ACME_WEBROOT` | `acme-webroot/` | Directory certbot writes challenge files into. |
| `PLZBOT_TRUST_PROXY` | unset | `1` / `N` = trust the last N `X-Forwarded-For` hops (and `X-Forwarded-Proto`). Leave unset unless a proxy you control is in front. |
| `PLZBOT_CLIENT_IP_HEADER` | unset | A header your proxy guarantees to set to the client IP (`cf-connecting-ip`, `fly-client-ip`, `true-client-ip`). Preferred over XFF. |
| `PLZBOT_PUBLIC_ORIGIN` | unset | `https://your.host` — used for redirects and the text report. |
| `PLZBOT_IP2ASN_PATH` | unset | Optional path to an iptoasn.com TSV for offline ASN/org lookups (free, no account). |
| `PLZBOT_DATABASE_URL` (or `DATABASE_URL`) | unset | Postgres connection string. Set = every fingerprint is saved (kept forever); unset = nothing is stored. A secret: keep it in `.env` only. |
| `PLZBOT_ADMIN_PASSWORD` | unset | 12+ characters. Enables the private analysis page at `/admin` (HTTP Basic auth, any username) over the stored fingerprints. Unset = `/admin` returns 404. Ten wrong attempts lock an IP out for 5 minutes. |
| `PLZBOT_RECAPTCHA_PROJECT_ID`, `_SITE_KEY`, `_API_KEY` | unset | All three turn on a Google reCAPTCHA Enterprise score on `/behavior` (key setup: Google's docs). None = off and nothing is sent to Google; some = startup error. The API key is a secret: `.env` only. |
| `PLZBOT_RECAPTCHA_MONTHLY_CAP` | `8000` | Stop calling Google after this many assessments per UTC month (in memory: a restart resets it). `0` = no cap. |
| `PLZBOT_RECAPTCHA_EXEMPT_IPS` | unset | Comma-separated addresses exempt from the per-visitor limits (5/min, 40/day). IPv6 matches by /64. |
| `PLZBOT_STORE_LIMIT_PER_MINUTE` / `_PER_HOUR` / `_PER_DAY` | `10` / `30` / `100` | Max fingerprints **saved** per visitor (IPv4 address or IPv6 /64) in each window; visitors still get their response. Over a limit the record is counted, not stored (shown on the admin page). `0` disables a tier. |
| `PLZBOT_STORE_MAX_TABLE_MB` | `800` | Stop saving visits while the stored data (`visits` + `fingerprint_docs`) is over this size (protects a 1 GB free database). `0` = no cap. |

## Option A — free VM, full TLS fingerprinting (recommended)

Any always-free VM works: **Oracle Cloud Always Free** (`VM.Standard.A1.Flex`, up to 4 OCPU /
24 GB, or `VM.Standard.E2.1.Micro`) or **Google Cloud** (`e2-micro` in `us-west1`/`us-central1`/
`us-east1`). Both are free indefinitely for one small instance; both need a card on file.

1. Create the VM (Ubuntu 22.04+/Debian 12), open **TCP 80 and 443** in the cloud firewall
   (OCI: VCN security list ingress rules; GCP: `--tags http-server,https-server`), and note
   its public IP.
2. Point a hostname at it. No domain? Use **sslip.io**: the hostname `A-B-C-D.sslip.io`
   resolves to `A.B.C.D` with zero setup, and Let's Encrypt issues for it.
3. On the VM:
   ```sh
   # Docker (Ubuntu/Debian)
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker
   # On Ubuntu images, also open the OS firewall (OCI images ship with iptables rules):
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save 2>/dev/null || true

   git clone https://github.com/thedtripp/plzbot.me.git && cd plzbot.me
   cp deploy/env.example .env && $EDITOR .env      # PLZBOT_DOMAIN, ACME_EMAIL
   ./deploy/bootstrap-certs.sh                       # first certificate (standalone on :80)
   docker compose up -d --build
   ```
4. Visit `https://<your hostname>/`. Renewal is automatic (certbot sidecar every 12 h; the
   app reloads the files without a restart).

`deploy/oci-create-vm.sh` scripts step 1 for Oracle Cloud with the `oci` CLI.

### Redeploying after a change

The app, including `public/` (HTML, CSS, JS), is baked into the Docker image, so every change
ships the same way: pull, rebuild, recreate. On the VM, from the repo folder:

```sh
git pull --ff-only
docker compose build plzbot
docker compose up -d
docker compose ps        # plzbot should report "healthy" within ~15 s
curl -sI https://<your hostname>/ | head -1
```

- Only the `plzbot` container is recreated. Certificates live in a volume and renewal keeps
  running, so the only downtime is the few seconds the container restarts.
- A host-specific `docker-compose.override.yml` (see below) is untracked, so `git pull` leaves it alone.
- The first build on a 1 GB VM takes a couple of minutes and needs swap (2 GB is plenty).
- **Roll back:** `git checkout <previous-commit>`, then `docker compose build plzbot && docker compose up -d`.
  Run `git checkout main` before the next `git pull`.
- From a laptop with the Google Cloud CLI, the same thing in one line:
  `gcloud compute ssh <vm> --zone <zone> --project <project> --command 'cd ~/plzbot.me && git pull --ff-only && docker compose build plzbot && docker compose up -d'`

### Host-specific compose settings (`docker-compose.override.yml`)

Anything specific to one machine goes in `docker-compose.override.yml`, which is git-ignored.
The one you are most likely to need: **if something else already listens on :443 on the VM**,
Docker fails with `failed to bind host port 0.0.0.0:443/tcp: address already in use`. Tailscale
does this when it serves a page with `tailscale serve` (it binds :443 on the VM's Tailscale
address). Bind plzbot to the VM's primary address instead; a public visitor still reaches it:

```sh
IP=$(ip -4 -o addr show ens4 | awk '{print $4}' | cut -d/ -f1)   # primary interface; may not be ens4
cat > docker-compose.override.yml <<EOF
services:
  plzbot:
    ports: !override
      - "$IP:80:80"
      - "$IP:443:443"
EOF
docker compose up -d
```

On Google Cloud the VM's public IP is ephemeral (it survives a reboot, but not a stop/start), and
the firewall needs a rule allowing TCP 80 and 443 plus a matching network tag on the instance. If
you point DNS at the IP, reserve it as a static address first.

### Optional: ASN / network-owner lookups

Download the public-domain table from iptoasn.com (~40 MB) and point the app at it — no API key:
```sh
mkdir -p data && curl -L https://iptoasn.com/data/ip2asn-combined.tsv.gz | gunzip > data/ip2asn-combined.tsv
echo PLZBOT_IP2ASN_PATH=/data/ip2asn-combined.tsv >> .env && docker compose up -d
```

## Option B — PaaS, HTTP mode (no TLS fingerprint)

Build with the included `Dockerfile` (or `npm ci && npm run build && npm start`) and set:

```
PLZBOT_MODE=http
PLZBOT_TRUST_PROXY=1            # the platform's proxy appends one XFF hop
PLZBOT_PUBLIC_ORIGIN=https://<your-app-host>
```

- **Render** (free web service): Docker runtime, health check path `/healthz`. Uses `PORT`.
- **Fly.io**: `fly launch --no-deploy`, set `internal_port = 8080`, env as above plus
  `PLZBOT_CLIENT_IP_HEADER=fly-client-ip`. (Fly can also do raw TCP passthrough, which lets
  TLS mode work — see Fly's `services` config with no `tls` handler — but Fly has no free tier.)
- **Koyeb** / **Railway** / **Google Cloud Run**: same env; Cloud Run sets `PORT`.
- **Behind Cloudflare**: `PLZBOT_CLIENT_IP_HEADER=cf-connecting-ip`.

Visitors in HTTP mode see the TLS section honestly marked unavailable, with the reason.

## Local

```sh
npm run dev          # TLS mode, https://127.0.0.1:8443, self-signed cert
npm run dev:http     # HTTP mode, http://0.0.0.0:8080
docker build -t plzbot . && docker run --rm -p 8080:8080 -e PLZBOT_MODE=http -e PLZBOT_PORT=8080 plzbot
```
