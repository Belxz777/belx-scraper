#!/usr/bin/env bash

set -e

cd /root/apps/pilot-scraper

docker exec \
  pilot-bot \
  bun src/bot/cron.ts