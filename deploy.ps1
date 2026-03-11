$ErrorActionPreference = "Stop"

Write-Host "Pushing to GitHub..."
git push

Write-Host "Deploying to NAS..."
ssh AdminNas@192.168.254.200 "cd /share/docker/compose/backlog-boss && git pull && sudo docker build -t backlog-boss . && sudo docker compose down && sudo docker compose up -d"

Write-Host "Deploy complete."
