#!/bin/bash

cd /home/dietpi/radio-revive/rpi-agent

# Log start time
echo "[$(date +'%Y-%m-%d %H:%M:%S %Z')] Starting agent with PID $$" >> agent.log

# Start the agent
exec node dist/index.js >> agent.log 2>&1
