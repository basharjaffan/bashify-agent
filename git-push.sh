#!/bin/bash
# Git commit and push script

cd /home/dietpi/radio-revive/rpi-agent

echo "📦 Git status:"
git status

echo ""
read -p "Commit message: " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    echo "❌ No commit message provided"
    exit 1
fi

echo "➕ Adding files..."
git add .

echo "💾 Committing..."
git commit -m "$COMMIT_MSG"

echo "🚀 Pushing to remote..."
git push

if [ $? -eq 0 ]; then
    echo "✅ Successfully pushed to git!"
else
    echo "❌ Push failed!"
    exit 1
fi
