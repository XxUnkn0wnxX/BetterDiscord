#!/usr/bin/env zsh

set -euo pipefail

repo_dir="${0:A:h}"
cd "$repo_dir"

mode="dist"
if [[ $# -gt 0 && "$1" != --* ]]; then
    mode="$1"
    shift
fi

case "$mode" in
    build)
        bun scripts/build.ts "$@"
        ;;
    production)
        NODE_ENV=production bun scripts/build.ts --minify "$@"
        ;;
    pack)
        bun scripts/pack.ts
        ;;
    dist)
        NODE_ENV=production bun scripts/build.ts --minify "$@"
        bun scripts/pack.ts
        ;;
    *)
        echo "Usage: ./local-build.zsh [build|production|pack|dist] [extra args...]"
        echo "Build option: --macos-recovery-timeout-seconds <seconds> (default: 90)"
        exit 1
        ;;
esac
