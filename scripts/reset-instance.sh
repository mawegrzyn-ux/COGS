#!/bin/bash
# =============================================================================
# Lightsail Instance Reset Script
# Wipes all application data while preserving system packages
# (Node.js, Nginx, PostgreSQL, PM2, Certbot)
#
# Usage: sudo bash reset-instance.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

NEW_DOMAIN="nadakarate.com"

echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  LIGHTSAIL INSTANCE RESET                                   ║${NC}"
echo -e "${YELLOW}║  This will wipe ALL application data, databases, and configs ║${NC}"
echo -e "${YELLOW}║  System packages (Node, Nginx, PG, PM2) will be preserved   ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${RED}WARNING: This is DESTRUCTIVE and IRREVERSIBLE.${NC}"
echo ""
read -p "Type 'WIPE' to confirm: " CONFIRM
if [ "$CONFIRM" != "WIPE" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo -e "${GREEN}[1/8] Stopping PM2 processes...${NC}"
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
pm2 save --force 2>/dev/null || true
echo "  ✔ All PM2 processes removed"

echo ""
echo -e "${GREEN}[2/8] Dropping PostgreSQL databases...${NC}"
# List all non-system databases and drop them
DATABASES=$(sudo -u postgres psql -t -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');" 2>/dev/null | tr -d ' ' | grep -v '^$' || true)
if [ -n "$DATABASES" ]; then
  for db in $DATABASES; do
    echo "  Dropping database: $db"
    sudo -u postgres dropdb --if-exists "$db" 2>/dev/null || true
  done
  echo "  ✔ All application databases dropped"
else
  echo "  ✔ No application databases found"
fi

# Drop all non-default PostgreSQL roles
ROLES=$(sudo -u postgres psql -t -c "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname != 'postgres';" 2>/dev/null | tr -d ' ' | grep -v '^$' || true)
if [ -n "$ROLES" ]; then
  for role in $ROLES; do
    echo "  Dropping role: $role"
    sudo -u postgres psql -c "DROP ROLE IF EXISTS \"$role\";" 2>/dev/null || true
  done
  echo "  ✔ Application database roles dropped"
fi

echo ""
echo -e "${GREEN}[3/8] Removing application files...${NC}"
rm -rf /var/www/menu-cogs
rm -rf /var/www/html/index.nginx-debian.html
# Remove any other app directories under /var/www (but keep /var/www itself)
find /var/www -mindepth 1 -maxdepth 1 -type d ! -name 'html' -exec rm -rf {} + 2>/dev/null || true
echo "  ✔ /var/www cleaned"

# Remove any app files in ubuntu home
rm -rf /home/ubuntu/.env* 2>/dev/null || true
rm -rf /home/ubuntu/node_modules 2>/dev/null || true
rm -rf /home/ubuntu/package*.json 2>/dev/null || true
echo "  ✔ Home directory cleaned"

echo ""
echo -e "${GREEN}[4/8] Removing Nginx site configs...${NC}"
rm -f /etc/nginx/sites-enabled/menu-cogs 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
rm -f /etc/nginx/sites-available/menu-cogs 2>/dev/null || true
rm -f /etc/nginx/sites-available/kanban.macaroonie.com.conf 2>/dev/null || true
# Remove any other non-default site configs
find /etc/nginx/sites-enabled/ -type l -delete 2>/dev/null || true
find /etc/nginx/sites-available/ -type f ! -name 'default' -delete 2>/dev/null || true
echo "  ✔ Nginx site configs removed"

echo ""
echo -e "${GREEN}[5/8] Revoking old SSL certificates...${NC}"
# Delete all certbot certificates
CERTS=$(sudo certbot certificates 2>/dev/null | grep "Certificate Name:" | awk '{print $3}' || true)
if [ -n "$CERTS" ]; then
  for cert in $CERTS; do
    echo "  Revoking: $cert"
    sudo certbot delete --cert-name "$cert" --non-interactive 2>/dev/null || true
  done
  echo "  ✔ Old SSL certificates removed"
else
  echo "  ✔ No SSL certificates found"
fi

echo ""
echo -e "${GREEN}[6/8] Setting up fresh Nginx config for ${NEW_DOMAIN}...${NC}"

cat > /etc/nginx/sites-available/${NEW_DOMAIN} << 'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name nadakarate.com www.nadakarate.com;

    root /var/www/nadakarate/frontend;
    index index.html;

    # API — update port to match your app
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        client_max_body_size 20M;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    add_header X-Frame-Options        "SAMEORIGIN"   always;
    add_header X-Content-Type-Options "nosniff"      always;
    add_header Referrer-Policy        "no-referrer-when-downgrade" always;

    access_log /var/log/nginx/nadakarate-access.log;
    error_log  /var/log/nginx/nadakarate-error.log;
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/${NEW_DOMAIN} /etc/nginx/sites-enabled/
echo "  ✔ Nginx config created for ${NEW_DOMAIN}"

echo ""
echo -e "${GREEN}[7/8] Preparing directory structure...${NC}"
mkdir -p /var/www/nadakarate/frontend
echo "<h1>nadakarate.com</h1><p>Coming soon.</p>" > /var/www/nadakarate/frontend/index.html
chown -R ubuntu:ubuntu /var/www/nadakarate
echo "  ✔ /var/www/nadakarate ready"

echo ""
echo -e "${GREEN}[8/8] Restarting Nginx...${NC}"
nginx -t && nginx -s reload
echo "  ✔ Nginx reloaded"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  RESET COMPLETE                                             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Instance is clean. Next steps:"
echo ""
echo "  1. Point DNS A record for ${NEW_DOMAIN} to this server's IP"
echo "     (and www.${NEW_DOMAIN} if you want www redirect)"
echo ""
echo "  2. Once DNS propagates, get SSL certificate:"
echo "     sudo certbot --nginx -d ${NEW_DOMAIN} -d www.${NEW_DOMAIN}"
echo ""
echo "  3. Create a PostgreSQL database for your new app:"
echo "     sudo -u postgres createuser myapp"
echo "     sudo -u postgres createdb myapp -O myapp"
echo "     sudo -u postgres psql -c \"ALTER USER myapp PASSWORD 'your-password';\""
echo ""
echo "  4. Clone your repo and deploy:"
echo "     cd /var/www/nadakarate"
echo "     git clone https://github.com/your-org/your-repo.git ."
echo "     cd api && npm install --production && npm run migrate"
echo "     pm2 start src/index.js --name nadakarate-api"
echo "     cd ../app && npm install && npm run build"
echo "     cp -r dist/* ../frontend/"
echo "     pm2 save"
echo ""
echo "  5. Verify:"
echo "     curl -I https://${NEW_DOMAIN}"
echo ""
