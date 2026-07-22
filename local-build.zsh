#!/usr/bin/env zsh

set -euo pipefail

repo_dir="${0:A:h}"
cd "$repo_dir"

usage() {
    print -r -- "Usage: ./local-build.zsh [build|production|pack|dist] [options]"
    print -r -- ""
    print -r -- "Modes:"
    print -r -- "  build       Build unpacked development files"
    print -r -- "  production  Build minified production files"
    print -r -- "  pack        Pack the existing dist files"
    print -r -- "  dist        Build production files and pack betterdiscord.asar (default)"
    print -r -- ""
    print -r -- "Options:"
    print -r -- "  --macos-recovery-timeout-seconds <seconds>  Build-time recovery timeout (default: 90)"
    print -r -- "  -mrts <seconds>                              Alias for the recovery timeout option"
    print -r -- "  -h, --help                                  Show this help"
    print -r -- ""
    print -r -- "Examples:"
    print -r -- "  ./local-build.zsh"
    print -r -- "  ./local-build.zsh build --module=betterdiscord"
    print -r -- "  ./local-build.zsh -mrts 45"
    print -r -- "  ./local-build.zsh --macos-recovery-timeout-seconds 45"
    print -r -- "  ./local-build.zsh dist --macos-recovery-timeout-seconds 45"
}

for argument in "$@"; do
    if [[ "$argument" = "-h" || "$argument" = "--help" ]]; then
        usage
        exit 0
    fi
done

normalized_args=()
for argument in "$@"; do
    if [[ "$argument" = "-mrts" ]]; then
        normalized_args+=("--macos-recovery-timeout-seconds")
    else
        normalized_args+=("$argument")
    fi
done
set -- "${normalized_args[@]}"

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
        usage >&2
        exit 1
        ;;
esac
