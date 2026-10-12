#!/usr/bin/env bash
# ==============================================================================
# Elliot Lano Portfolio — One-Command GitHub Deployment Script
# ==============================================================================

set -e

REPO_NAME="${1:-portfolio}"
GITHUB_USERNAME="kdust2"

echo "=========================================================="
echo "  Deploying Elliot Lano Portfolio to GitHub (${GITHUB_USERNAME}/${REPO_NAME})"
echo "=========================================================="

# 1. Ensure git is on main branch and clean
git branch -M main

# 2. Add remote origin
REMOTE_URL="https://github.com/${GITHUB_USERNAME}/${REPO_NAME}.git"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

echo "Remote configured: $REMOTE_URL"
echo ""
echo "To push your code, run:"
echo "  git push -u origin main"
echo ""
echo "If your repository is already created on GitHub and you have a Personal Access Token (PAT):"
echo "  git push https://<YOUR_GITHUB_TOKEN>@github.com/${GITHUB_USERNAME}/${REPO_NAME}.git main"
echo ""
echo "Next step for GitHub Pages:"
echo "1. Go to https://github.com/${GITHUB_USERNAME}/${REPO_NAME}/settings/pages"
echo "2. Under 'Build and deployment' -> 'Source', select 'Deploy from a branch'"
echo "3. Choose branch 'main' and folder '/ (root)'"
echo "4. Click Save. Your live site will be ready at:"
echo "   https://${GITHUB_USERNAME}.github.io/${REPO_NAME}/"
echo "=========================================================="
