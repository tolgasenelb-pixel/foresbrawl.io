# 🚀 Quick Start - Deploy to Render in 5 Minutes

## 1️⃣ Prepare Local Setup (2 min)

```bash
# Navigate to Forestbrawl directory
cd Forestbrawl

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

## 2️⃣ Create Secure Secret (1 min)

```bash
# Generate a secure AUTH_SECRET
openssl rand -base64 32

# Copy the output and add to .env:
# AUTH_SECRET=<paste-output-here>
```

**Edit `.env` file:**
```bash
# Replace with your generated secret
AUTH_SECRET=your-secure-secret-here
```

## 3️⃣ Test Locally (1 min)

```bash
# Start the server
npm start

# Open in browser: http://localhost:3000
# Try registering and logging in
```

Press `Ctrl+C` to stop the server.

## 4️⃣ Deploy to Render (5 min)

### Option A: Push to GitHub (Recommended)

```bash
# Initialize Git (if not done)
git init
git add .
git commit -m "Deploy to Render"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then on Render dashboard:
1. Go to [render.com](https://render.com)
2. Click "New Web Service"
3. Select your GitHub repository
4. Fill in the form:
   - **Name**: `forestbrawl`
   - **Build Command**: `npm ci`
   - **Start Command**: `npm start`
5. Add Environment Variables:
   ```
   AUTH_SECRET=your-secure-secret
   NODE_ENV=production
   PORT=3000
   DATA_FILE=/var/data/forest-data.json
   ```
6. **Add Persistent Disk**: `/var/data` (0.5 GB)
7. Click "Deploy"

### Option B: Deploy from Local

Use Render CLI (if installed):
```bash
# Login to Render
render login

# Deploy
render deploy
```

## ✅ Verify Deployment (1 min)

Once deployed (2-5 minutes):

```bash
# Check health
curl https://your-service-name.onrender.com/api/health

# Or use the health check script
./health-check.sh https://your-service-name.onrender.com
```

**Expected response:**
```json
{
  "ok": true,
  "online": 0
}
```

## 🎮 Play Your Game!

Visit: `https://your-service-name.onrender.com`

## 🆘 Common Issues

| Problem | Solution |
|---------|----------|
| "Service not starting" | Check `AUTH_SECRET` is set in Render dashboard |
| "502 Bad Gateway" | Check logs in Render, wait a few seconds, refresh |
| "Data not saving" | Verify persistent disk is mounted to `/var/data` |

## 📚 For More Help

- See `DEPLOYMENT.md` - Detailed deployment guide
- See `CHECKLIST.md` - Complete deployment checklist
- See `README.md` - Project overview

---

**That's it!** Your game is now live on the internet! 🎉

**Next Steps:**
- [ ] Invite friends to play
- [ ] Set up custom domain
- [ ] Add to GitHub as public repo
- [ ] Share your game link!
