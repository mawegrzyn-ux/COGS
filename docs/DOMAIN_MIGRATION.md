# Domain Migration Guide

How to change the domain or subdomain for the COGS Manager application.

**Current domain:** `cogs.flavorconnect.tech`
**Server IP:** `13.135.158.196` (static Lightsail IP — does not change)

---

## When Would You Need This?

- Moving to a new branded domain (e.g. `app.yournewdomain.com`)
- Changing from a subdomain to an apex domain (or vice versa)
- Consolidating under a different company domain

---

## Prerequisites

Before you begin:

1. **Domain purchased** — register at any registrar (Namecheap, GoDaddy, Cloudflare, etc.)
2. **Nameservers pointing to AWS** — in your registrar, set nameservers to Lightsail's NS records for your zone
3. **DNS zone created in Lightsail** — Lightsail console → DNS zones → Create zone for the apex domain

> **Tip:** Using a subdomain (e.g. `cogs.yourdomain.com`) is simpler than an apex domain — it just requires an A record in the existing zone with no nameserver changes.

---

## Step-by-Step Process

### Step 1 — Add DNS A Record

In the Lightsail DNS zone for your apex domain:

| Type | Subdomain | Resolves to |
|------|-----------|-------------|
| A | `cogs` (or desired subdomain) | `13.135.158.196` |

Verify propagation (usually 1–5 minutes):

```bash
nslookup cogs.yournewdomain.com
# Must return: 13.135.158.196
```

Do not proceed until this resolves correctly — Certbot needs working DNS to issue the SSL cert.

---

### Step 2 — Update Nginx `server_name`

SSH into the server (`ubuntu@13.135.158.196`) and edit the Nginx site config:

```bash
sudo nano /etc/nginx/sites-available/menu-cogs
```

Find the `server_name` line and replace it:

```nginx
server_name cogs.yournewdomain.com;
```

Test and reload:

```bash
sudo nginx -t          # Must say: syntax is ok / test is successful
sudo nginx -s reload
```

---

### Step 3 — Issue SSL Certificate

Run Certbot for the new domain. It automatically issues the cert and patches Nginx:

```bash
sudo certbot --nginx -d cogs.yournewdomain.com
```

Expected output:
```
Successfully received certificate.
Successfully deployed certificate for cogs.yournewdomain.com to /etc/nginx/sites-enabled/menu-cogs
Congratulations! You have successfully enabled HTTPS on https://cogs.yournewdomain.com
```

The cert auto-renews via a cron job. Test renewal any time with:

```bash
sudo certbot renew --dry-run
```

---

### Step 4 — Update Auth0 Allowed URLs

Go to [manage.auth0.com](https://manage.auth0.com) → Applications → your app → **Settings**.

Add the new domain to all three fields (keep existing entries while transitioning):

| Field | Add |
|-------|-----|
| Allowed Callback URLs | `https://cogs.yournewdomain.com` |
| Allowed Logout URLs | `https://cogs.yournewdomain.com/login` |
| Allowed Web Origins | `https://cogs.yournewdomain.com` |

Click **Save Changes**.

> **Note:** The Auth0 tenant name (`obscurekitty.uk.auth0.com`) is a fixed identifier chosen at tenant creation. It is completely independent of the app domain and never needs changing.

---

### Step 5 — Update GitHub Secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions**. Update both secrets:

| Secret | New value |
|--------|-----------|
| `LIGHTSAIL_HOST` | `cogs.yournewdomain.com` |
| `VITE_API_URL` | `https://cogs.yournewdomain.com/api` |

> **Critical:** `VITE_API_URL` must be the full URL including `https://`. Never build it by concatenating `http://` with `LIGHTSAIL_HOST` in `deploy.yml` — this was the root cause of a previous outage (1,252+ blocked requests due to mixed content).

---

### Step 6 — Deploy and Verify

Trigger a new deploy by pushing to `main`. An empty commit works:

```bash
git commit --allow-empty -m "chore: switch domain to cogs.yournewdomain.com"
git push
```

Watch the pipeline at `github.com/mawegrzyn-ux/COGS/actions`. The final step is an automated health check:

```bash
curl https://cogs.yournewdomain.com/api/health
# Expected: {"status":"ok"}
```

If the health check passes, the deploy succeeded and the new domain is live.

---

### Step 7 — Update Documentation

Update the domain in these locations:

| File | What to change |
|------|----------------|
| `CLAUDE.md` | Sections 1 (Project Overview), 6 (CI/CD), 7 (Auth0), 18 (Domain Migration Log), 19 (Key Contacts) |
| `app/src/pages/HelpPage.tsx` | Domain Migration section + footer link |
| `docs/user-guide.md` | Production URL line |
| `docs/DOMAIN_MIGRATION.md` | This file — update "Current domain" at the top |
| `api/src/routes/nutrition.js` | `User-Agent` contact email if it uses the domain |

Finally, once the new domain is confirmed working, remove the old domain from Auth0 Callback / Logout / Web Origins to keep things clean.

---

## Migration Log

| Date | From | To | Notes |
|------|------|----|-------|
| April 2026 | `obscurekitty.com` | `cogs.flavorconnect.tech` | Moved from throwaway dev domain to branded subdomain under `flavorconnect.tech`. DNS zone created in Lightsail, A record added, Certbot cert issued, Auth0 + GitHub Secrets updated, CI/CD health check passed. |

---

## Troubleshooting

**`nslookup` returns wrong IP or NXDOMAIN**
- DNS propagation not complete — wait a few more minutes
- A record not saved correctly — check the Lightsail DNS zone

**Certbot fails with "DNS problem: NXDOMAIN"**
- DNS hasn't propagated yet — wait and retry

**Auth0 "must run on a secure origin" error**
- SSL cert not yet issued, or Nginx not reloaded after cert deployment
- Run `sudo nginx -t && sudo nginx -s reload`

**API calls going to wrong URL after deploy**
- Vite baked in the old `VITE_API_URL` — check GitHub Secrets and re-trigger the deploy
- Never hardcode `http://` in `deploy.yml` — always use `${{ secrets.VITE_API_URL }}` directly
