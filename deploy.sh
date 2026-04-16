#!/bin/bash
# Hard Locals Content Ops - Deploy
set -e

if [ ! -f .env ]; then
  echo "⚠ .env not found. Copying from .env.example..."
  cp .env.example .env
  echo "✏ Edit .env with your keys:"
  echo "  nano .env"
  exit 1
fi

echo "→ Building..."
docker compose build

echo "→ Starting..."
docker compose up -d

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "✓ Deployed!"
echo "  → http://$IP:4000"
echo "  → Logs: docker compose logs -f"
