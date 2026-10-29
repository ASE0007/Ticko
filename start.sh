#!/bin/sh
set -e
# Render gives us $PORT (public). nginx listens there; the backend stays private on 4000.
PUBLIC_PORT="${PORT:-10000}"
sed "s/__PORT__/${PUBLIC_PORT}/" /etc/nginx/ticko.conf.template > /etc/nginx/conf.d/ticko.conf
nginx
export PORT=4000
npx prisma migrate deploy
npx tsx prisma/seed.ts
exec node dist/server.js
