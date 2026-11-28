#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

[[ -f private/index.ts ]] || { printf 'Build local impossible : private/index.ts est absent.\n' >&2; exit 1; }
node node_modules/typescript/bin/tsc --project private/tsconfig.json
node scripts/build.cjs private
