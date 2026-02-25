#!/bin/bash
cd /home/ec2-user/savetheship-backend
export NODE_ENV=production
export PORT=8080
# Add other env vars or source .env
node server.js