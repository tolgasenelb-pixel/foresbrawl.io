#!/bin/bash
# Render Deployment Setup Script
# Run this before pushing to GitHub for deployment

set -e

echo "🚀 Forestbrawl Render Deployment Setup"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: server.js not found. Run this script from the Forestbrawl directory."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your secret AUTH_SECRET value"
fi

# Verify git is initialized
if [ ! -d ".git" ]; then
    echo "📝 Initializing git repository..."
    git init
    git add .
    git commit -m "Initial Forestbrawl deployment setup"
    echo "✅ Git initialized. Now run: git remote add origin <your-repo-url>"
fi

# Check Node.js version
NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Check required files
echo "✅ Checking required files..."
files=("server.js" "package.json" "render.yaml" ".env.example" "DEPLOYMENT.md")
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file"
    else
        echo "   ✗ $file (missing)"
    fi
done

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with a secure AUTH_SECRET: openssl rand -base64 32"
echo "2. Push to GitHub: git push -u origin main"
echo "3. Create new service on https://render.com"
echo "4. Set environment variables in Render dashboard"
echo "5. Enable auto-deploy from Git"
echo ""
echo "See DEPLOYMENT.md for detailed instructions."
