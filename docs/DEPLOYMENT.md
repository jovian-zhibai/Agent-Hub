# Deployment Guide

This guide covers deploying Agent Hub to various platforms.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Deployment Options](#deployment-options)
  - [Docker](#docker)
  - [Vercel](#vercel)
  - [Railway](#railway)
  - [DigitalOcean](#digitalocean)
  - [AWS](#aws)
- [Post-Deployment](#post-deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required

- **Node.js 18+**
- **PostgreSQL 14+**
- **Domain name** (recommended for production)
- **SSL certificate** (Let's Encrypt recommended)

### Environment Variables

Generate secure values for:

```bash
# Generate JWT secret (32 bytes)
openssl rand -hex 32

# Generate encryption key (32 bytes)
openssl rand -hex 32
```

## Environment Setup

Create a `.env.production` file:

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/database"

# Security (NEVER commit these)
JWT_SECRET="<generated-jwt-secret>"
KEY_ENCRYPTION_KEY="<generated-encryption-key>"

# API
NEXT_PUBLIC_API_URL="https://yourdomain.com/api"

# Optional
REDIS_URL="redis://localhost:6379"
```

## Deployment Options

### Docker

#### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/yourusername/agent-hub.git
cd agent-hub

# 2. Create production environment file
cp .env.example .env.production
# Edit .env.production with your values

# 3. Build and start services
docker compose --profile production up -d

# 4. Run migrations
docker compose exec app npx prisma migrate deploy

# 5. Create seed user (optional)
docker compose exec app npx prisma db seed
```

Your app will be available at `http://localhost:3000`.

#### Option 2: Standalone Docker

```bash
# 1. Build image
docker build -t agent-hub:latest .

# 2. Run PostgreSQL
docker run -d \
  --name agent-hub-db \
  -e POSTGRES_USER=agenthub \
  -e POSTGRES_PASSWORD=secure_password \
  -e POSTGRES_DB=agenthub \
  -p 5432:5432 \
  postgres:16-alpine

# 3. Run Agent Hub
docker run -d \
  --name agent-hub \
  --link agent-hub-db:postgres \
  -e DATABASE_URL="postgresql://agenthub:secure_password@postgres:5432/agenthub" \
  -e JWT_SECRET="your-jwt-secret" \
  -e KEY_ENCRYPTION_KEY="your-encryption-key" \
  -e NEXT_PUBLIC_API_URL="http://localhost:3000/api" \
  -p 3000:3000 \
  agent-hub:latest

# 4. Run migrations
docker exec agent-hub npx prisma migrate deploy
```

### Vercel

Vercel is great for the frontend, but you'll need an external PostgreSQL database.

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel --prod

# 4. Set environment variables in Vercel dashboard
# DATABASE_URL, JWT_SECRET, KEY_ENCRYPTION_KEY, NEXT_PUBLIC_API_URL
```

**Note**: Add this to `next.config.ts`:

```typescript
const nextConfig = {
  output: 'standalone', // For Docker
  // Remove 'standalone' for Vercel
};
```

### Railway

Railway provides both app hosting and PostgreSQL.

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Create new project
railway init

# 4. Add PostgreSQL
railway add

# 5. Set environment variables
railway variables set JWT_SECRET=your-secret
railway variables set KEY_ENCRYPTION_KEY=your-key

# 6. Deploy
railway up
```

Railway will automatically:
- Detect the Dockerfile
- Build the image
- Deploy the app
- Provide a public URL

### DigitalOcean

#### App Platform

1. Connect your GitHub repository
2. Configure:
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Run Command**: `npm start`
3. Add PostgreSQL database from marketplace
4. Set environment variables
5. Deploy

#### Droplet (VPS)

```bash
# 1. SSH into your droplet
ssh root@your-droplet-ip

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install PostgreSQL
apt-get install -y postgresql postgresql-contrib

# 4. Clone repository
git clone https://github.com/yourusername/agent-hub.git
cd agent-hub

# 5. Setup
npm install
npm run setup

# 6. Build
npm run build

# 7. Install PM2
npm install -g pm2

# 8. Start with PM2
pm2 start npm --name "agent-hub" -- start
pm2 save
pm2 startup
```

### AWS

#### EC2 + RDS

```bash
# 1. Launch EC2 instance (t3.small recommended)
# 2. Launch RDS PostgreSQL instance
# 3. Configure security groups

# 4. SSH to EC2
ssh -i your-key.pem ec2-user@your-instance

# 5. Install dependencies
sudo yum install -y git nodejs

# 6. Clone and setup
git clone https://github.com/yourusername/agent-hub.git
cd agent-hub
npm install

# 7. Set environment variables
export DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/db"
export JWT_SECRET="your-secret"
export KEY_ENCRYPTION_KEY="your-key"

# 8. Build and start
npm run build
npm start
```

#### ECS (Fargate)

1. Push Docker image to ECR
2. Create ECS cluster
3. Create task definition
4. Configure RDS connection
5. Create service

## Post-Deployment

### 1. Run Database Migrations

```bash
npx prisma migrate deploy
```

### 2. Create First User

```bash
# Via API
curl -X POST https://yourdomain.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin",
    "email": "admin@example.com",
    "password": "secure-password",
    "plan": "pro"
  }'
```

### 3. Configure Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4. Setup SSL with Let's Encrypt

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

### 5. Setup Monitoring

- Use health check endpoint: `https://yourdomain.com/api/health`
- Configure uptime monitoring (UptimeRobot, Pingdom, etc.)
- Setup logging aggregation (Datadog, Sentry, etc.)

## Production Checklist

- [ ] Secure environment variables set
- [ ] Database migrations applied
- [ ] SSL/TLS enabled
- [ ] Reverse proxy configured
- [ ] Health checks working
- [ ] Backups configured
- [ ] Monitoring setup
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] Error tracking setup

## Backup Strategy

### Database Backups

```bash
# Automated daily backup
0 2 * * * pg_dump $DATABASE_URL > /backups/db-$(date +\%Y\%m\%d).sql
```

### Application Backups

- Store `.env` securely (password manager)
- Version control for code
- Document all configuration changes

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
systemctl status postgresql

# Check connection
psql $DATABASE_URL

# Check firewall
sudo ufw status
```

### App Won't Start

```bash
# Check logs
docker logs agent-hub

# Or if using PM2
pm2 logs agent-hub

# Check port is not in use
lsof -i :3000
```

### Migrations Failed

```bash
# Reset database (CAUTION: deletes all data)
npx prisma migrate reset

# Or manually apply
npx prisma migrate deploy --force
```

### High Memory Usage

- Increase container memory limits
- Check for memory leaks
- Enable Node.js garbage collection logging
- Consider upgrading server resources

## Performance Optimization

### Enable Caching

Add Redis for session and data caching:

```typescript
// lib/redis.ts
import { createClient } from 'redis';

export const redis = createClient({
  url: process.env.REDIS_URL
});
```

### Database Optimization

```sql
-- Add indexes (if not already present from migrations)
CREATE INDEX idx_keys_account_provider ON keys(account_id, provider_id);
CREATE INDEX idx_telemetry_agent_time ON telemetry_logs(agent_id, reported_at DESC);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM keys WHERE account_id = 'xxx';
```

### CDN for Static Assets

Configure CDN (Cloudflare, CloudFront) for:
- Static assets
- Images
- Fonts

## Security Hardening

1. **Firewall**: Only open necessary ports (80, 443, 22)
2. **Fail2ban**: Protect against brute force
3. **Regular Updates**: Keep system and dependencies updated
4. **Database**: Use strong passwords, restrict network access
5. **Application**: Keep JWT_SECRET and KEY_ENCRYPTION_KEY secure

## Monitoring & Alerts

### Key Metrics to Monitor

- API response times
- Error rates
- Database connection pool
- Memory/CPU usage
- Disk space
- Active users

### Recommended Tools

- **Application**: Sentry, DataDog, New Relic
- **Infrastructure**: Prometheus + Grafana
- **Uptime**: UptimeRobot, Pingdom
- **Logs**: ELK Stack, Loki

## Support

For deployment issues:
- Check [GitHub Issues](https://github.com/yourusername/agent-hub/issues)
- Join [Discord Community](#)
- Email support@agent-hub.dev
