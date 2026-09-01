# ✅ Render Deployment Checklist

## Pre-Deployment (Local)

- [ ] **Environment Setup**
  - [ ] Copy `.env.example` to `.env`
  - [ ] Generate secure AUTH_SECRET: `openssl rand -base64 32`
  - [ ] Update `AUTH_SECRET` in `.env`
  - [ ] Verify `NODE_ENV=production` in `.env`

- [ ] **Code Quality**
  - [ ] Test locally: `npm install && npm start`
  - [ ] Visit `http://localhost:3000`
  - [ ] Try login functionality
  - [ ] Check `/api/health` endpoint
  - [ ] Verify game loads and plays

- [ ] **Git Repository**
  - [ ] Initialize Git: `git init`
  - [ ] Create `.gitignore` (already exists ✓)
  - [ ] Commit files: `git add . && git commit -m "Deploy setup"`
  - [ ] Push to GitHub: `git push -u origin main`

- [ ] **Files Present**
  - [ ] ✓ `server.js` (Node.js server)
  - [ ] ✓ `game/` directory (static files)
  - [ ] ✓ `package.json` (dependencies)
  - [ ] ✓ `render.yaml` (Render config)
  - [ ] ✓ `.env.example` (env template)
  - [ ] ✓ `.nvmrc` (Node.js version)
  - [ ] ✓ `DEPLOYMENT.md` (this guide)
  - [ ] ✓ `README.md` (project info)

## Render Dashboard Setup

- [ ] **Create Service**
  - [ ] Go to [render.com](https://render.com)
  - [ ] Click "New Web Service"
  - [ ] Connect GitHub account
  - [ ] Select `Forestio` repository
  - [ ] Select `main` branch

- [ ] **Configure Service**
  - [ ] **Name**: `forestbrawl`
  - [ ] **Runtime**: Node.js
  - [ ] **Region**: Frankfurt (or closest to you)
  - [ ] **Plan**: Free tier (or Starter)
  - [ ] **Build Command**: `npm ci`
  - [ ] **Start Command**: `npm start`
  - [ ] **Node Version**: 24 (shown in .nvmrc)

- [ ] **Environment Variables**
  - [ ] `PORT` = `3000`
  - [ ] `NODE_ENV` = `production`
  - [ ] `AUTH_SECRET` = `<your-secure-secret>` (from `openssl rand -base64 32`)
  - [ ] `DATA_FILE` = `/var/data/forest-data.json` (with persistent disk)

- [ ] **Persistent Disk (Important!)**
  - [ ] Click "Add Persistent Disk"
  - [ ] **Mount Path**: `/var/data`
  - [ ] **Size**: 0.5 GB (minimum)
  - [ ] Make sure `DATA_FILE` env var points to this disk

- [ ] **Auto-Deploy**
  - [ ] Enable auto-deploy on code push
  - [ ] Enable deploy notifications (optional)

## Deployment

- [ ] **Initial Deploy**
  - [ ] Render should auto-deploy on git push
  - [ ] Watch deployment logs
  - [ ] Deployment should complete in 2-5 minutes
  - [ ] Check "Deployment" tab for status

- [ ] **Verify Live Service**
  - [ ] Visit `https://<your-service-name>.onrender.com`
  - [ ] Game should load and be playable
  - [ ] Run health check: `./health-check.sh https://<your-service-name>.onrender.com`
  - [ ] Try creating account and logging in
  - [ ] Check `/api/health` returns `{ok: true, online: ...}`

## Post-Deployment

- [ ] **Monitoring**
  - [ ] Set up error alerts in Render
  - [ ] Monitor CPU/Memory usage
  - [ ] Check error logs if issues occur

- [ ] **Custom Domain (Optional)**
  - [ ] Go to Service Settings
  - [ ] Add Custom Domain
  - [ ] Point DNS to Render nameservers
  - [ ] SSL certificate auto-generated

- [ ] **Backup Strategy**
  - [ ] Regularly backup `forest-data.json`
  - [ ] Use Render's file browser or SFTP
  - [ ] Store in secure location

- [ ] **Scaling (If Needed)**
  - [ ] Monitor player count
  - [ ] Upgrade plan if needed (Starter → Standard)
  - [ ] Consider database migration for 1000+ players

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Service won't start | Check logs, verify `AUTH_SECRET` is set |
| 502 Bad Gateway | Check error logs, restart service |
| Data not persisting | Verify persistent disk is mounted |
| Players can't connect | Check CORS, verify service URL in game code |
| High memory usage | May need to upgrade plan or optimize code |

## Useful Commands

```bash
# Test locally
npm install
npm start

# Generate secure secret
openssl rand -base64 32

# View Render logs (after deployment)
curl https://<service-name>.onrender.com/api/health

# Health check script
./health-check.sh https://<service-name>.onrender.com
```

## Security Reminders

✅ DO:
- [ ] Change `AUTH_SECRET` to random value
- [ ] Use HTTPS only (auto on Render)
- [ ] Keep dependencies updated
- [ ] Monitor logs for errors
- [ ] Backup player data regularly

❌ DON'T:
- [ ] Don't use default `AUTH_SECRET`
- [ ] Don't commit `.env` to Git
- [ ] Don't expose sensitive data in logs
- [ ] Don't run on unsecured HTTP

---

**Status**: 🚀 Ready for deployment!

**Deployment Time**: ~2-5 minutes
**Cost**: Free tier available (with limits)
**Uptime**: 99.5% SLA on Standard+

Need help? See DEPLOYMENT.md for detailed instructions.
