#!/usr/bin/env bash
# Ask the PM2 monitor for an immediate health check after an edit.
#
# Vite HMR (client :5200) and tsx watch (server :4040) already apply edits in place, so a blanket
# restart on every edit would throw away the very thing that keeps edits live. All the deciding —
# port-truth probing, restart, storm backoff — lives in scripts/monitor.mjs; this only asks it to
# check now instead of waiting up to 15s for the next interval.
#
# Run by the PostToolUse hook in .claude/settings.json (async), and usable by hand: npm run live
set -u

CHECK=http://localhost:4041/api/monitor/check

probe() { curl -sf -m 10 -X POST "$CHECK"; }

# The monitor is the one thing nothing else revives, so this is where it gets revived. Reaching
# here means :4041 is unanswered, so there is no live instance to protect — delete before start,
# because `pm2 start --name` happily registers a second entry under the same name and the loser of
# that race sits in an EADDRINUSE crash loop forever.
out=$(probe) || {
  npx pm2 delete intromate-monitor >/dev/null 2>&1
  npx pm2 start scripts/monitor.mjs --name intromate-monitor >/dev/null 2>&1
  out=$(curl -sf -m 10 --retry 5 --retry-delay 1 --retry-connrefused -X POST "$CHECK") || exit 0
}

restarted=$(printf '%s' "$out" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).restarted.join(", ")' 2>/dev/null)
[ -n "${restarted:-}" ] && printf '{"systemMessage":"Dev server was down — restarted: %s"}\n' "$restarted"
exit 0
