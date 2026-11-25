#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ -f private/index.ts ]]; then
  node node_modules/typescript/bin/tsc --project private/tsconfig.json
  node scripts/build.cjs private
else
  npm run build
fi
