#!/bin/sh
# A közös fájlokat (shared/) bemásolja a bírói appba és a néző oldalba.
cd "$(dirname "$0")"
cp shared/core.js shared/style.css android/app/src/main/assets/www/
cp shared/core.js shared/style.css viewer/
echo "Kész."
