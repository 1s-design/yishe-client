#!/bin/bash
LOG=D:/workspace/yishe-client/src/main/ps-automation/logs/memory-watch-$(date +%Y%m%d).log
echo "==== monitor started $(date '+%F %T') ====" >> "$LOG"
while true; do
  ts=$(date '+%F %T')
  resp=$(curl -s -m 8 http://localhost:1595/memoryStatus 2>/dev/null)
  if [ -z "$resp" ]; then
    echo "$ts | ERROR: memoryStatus unreachable" >> "$LOG"
  else
    echo "$ts | $resp" >> "$LOG"
  fi
  sleep 120
done
