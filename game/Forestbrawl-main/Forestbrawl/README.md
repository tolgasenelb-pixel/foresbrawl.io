# Forestbrawl 🌲⚔️

A multiplayer real-time browser-based RPG game built with Node.js and Socket.IO.

## 🎮 Features

- **Real-time Multiplayer**: Play with others using WebSocket (Socket.IO)
- **Progressive Web App**: Works offline with Service Worker
- **Rich Game World**:
  - 80+ unique mob types across different biomes
  - 28+ playable character skins
  - Dynamic weapon tiers and equipment system
  - Player ranking system (12 tiers)
  - Clan and party systems
  - Building placement and resource management

- **Player Systems**:
  - Account creation and authentication
  - Persistent player profiles and stats
  - Leaderboards (top 100 players)
  - XP-based progression
  - Shop and inventory system

## 🚀 Quick Start

### Prerequisites
- Node.js 24.x or higher
- npm or yarn

### Local Development

```bash
# Install dependencies
npm install

# Set environment variables (optional)
export AUTH_SECRET="your-secret-key"
export PORT=3000

# Start the server
npm start
```

The game will be available at `http://localhost:3000`

### Environment Variables

See `.env.example` for all available options:
- `PORT` - Server port (default: 3000)
- `AUTH_SECRET` - Secret key for authentication (change in production!)
- `DATA_FILE` - Path to persistent data file (default: ./forest-data.json)
- `NODE_ENV` - Environment mode (development/production)

## 📁 Project Structure

```
├── server.js              # Main Node.js server with Socket.IO
├── game/                  # Client-side static files
│   ├── index.html         # Landing page
│   ├── play.html          # Game interface
│   ├── preview.html       # Game preview
│   ├── sw.js              # Service Worker (offline support)
│   ├── manifest.json      # PWA configuration
│   ├── asset/             # Game sprites and assets
│   ├── mobs/              # Enemy mob sprites (80+)
│   ├── players/           # Character skins (28+)
│   └── weapons/           # Weapon assets
├── forest-data.json       # Persistent player/clan data
├── package.json           # Dependencies
├── render.yaml            # Render.com deployment config
└── DEPLOYMENT.md          # Deployment guide
```

## 🕹️ Game Mechanics

### Core Gameplay
- Navigate a procedurally generated forest world
- Fight mobs to gain XP and coins
- Build structures (farms, fences, gates)
- Join clans and parties
- Climb the leaderboard

### Player Progression
- 12 ranking tiers: Tohum → Tanrısal
- XP-based level progression
- Equipment upgrades
- Cosmetic skins and accessories

### Biomes
- Forest (spiders, basic mobs)
- Desert (scorpions, desert creatures)
- Snow (ice mobs, winter creatures)
- Swamp (poison creatures, swamp dwellers)
- Dark Forest (boss mobs, rare creatures)

## 🔌 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | User login |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/leaderboard` | Top 100 players |
| GET | `/api/profile` | User profile |
| POST | `/api/shop/buy` | Purchase item |
| GET | `/api/health` | Health check |

## 🚢 Deployment

### Deploy to Render

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

Quick deploy:
1. Push to GitHub
2. Create Web Service on Render
3. Set environment variables
4. Enable auto-deploy
5. Visit your live game URL

### Other Platforms

Works on any Node.js hosting:
- Heroku
- Railway
- Glitch
- Replit
- AWS, Azure, Google Cloud

## 📊 Performance

- **Lightweight**: Only Socket.IO as production dependency
- **Free Tier**: Supports ~10-50 concurrent players
- **Paid Tier**: Scales to 100s-1000s of players
- **Data**: JSON-based (upgradeable to MongoDB/PostgreSQL)

## 🔐 Security

- Password hashing with scrypt
- JWT-based authentication
- Input validation on all endpoints
- HTTPS/TLS on production
- Rate limiting recommended

## 🛠️ Development

### Adding New Mobs
Edit `MOB_TYPES` in `server.js`:
```javascript
{
  shape: 'unique-shape',
  color: '#hexcolor',
  outline: '#hexcolor',
  eyes: '#hexcolor',
  typeName: 'Display Name',
  radius: 40,
  hp: 100,
  dmg: 20
}
```

### Adding New Skins
Add PNG files to `game/players/` directory.

### Custom Items
Modify shop system in `server.js` to add new purchasable items.

## 📝 License

[Specify your license here]

## 👥 Contributors

- Development team

## 🐛 Bug Reports

Found a bug? Create an issue on GitHub with:
- Game version
- Browser/OS
- Steps to reproduce
- Screenshots

## 🎯 Roadmap

- [ ] Persistent database (MongoDB/PostgreSQL)
- [ ] Mobile app (React Native)
- [ ] Trading system
- [ ] PvP arenas
- [ ] Dungeons and raids
- [ ] Skill trees
- [ ] Pet system

## 📞 Support

- [Render Documentation](https://render.com/docs)
- [Socket.IO Documentation](https://socket.io/docs/)
- [Node.js Documentation](https://nodejs.org/docs/)

---

**Happy gaming!** 🎮✨
