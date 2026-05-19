#!/usr/bin/env zsh

set -euo pipefail

repo_dir="${0:A:h}"
cd "$repo_dir"

target="${1:-}"
inject_mode="${2:-release}"

if [[ "$#" -gt 2 ]]; then
    echo "Usage: ./local-inject.zsh [stable|ptb|canary] [release|dev]"
    exit 1
fi

if [[ -z "$target" ]]; then
    echo "Select Discord channel to inject:"
    echo "  1) stable"
    echo "  2) ptb"
    echo "  3) canary"
    printf "Choice [1-3]: "
    read -r selection

    case "$selection" in
        1|stable)
            target="stable"
            ;;
        2|ptb)
            target="ptb"
            ;;
        3|canary)
            target="canary"
            ;;
        *)
            echo "Invalid selection."
            exit 1
            ;;
    esac
fi

case "$inject_mode" in
    release|dev)
        ;;
    *)
        echo "Usage: ./local-inject.zsh [stable|ptb|canary] [release|dev]"
        exit 1
        ;;
esac

case "$target" in
    stable|discord)
        app_name="Discord"
        inject_target=""
        ;;
    ptb)
        app_name="Discord PTB"
        inject_target="ptb"
        ;;
    canary)
        app_name="Discord Canary"
        inject_target="canary"
        ;;
    *)
        echo "Usage: ./local-inject.zsh [stable|ptb|canary] [release|dev]"
        exit 1
        ;;
esac

function app_pids() {
    ps ax -o pid= -o command= | awk -v app="$app_name" 'index($0, "/" app ".app/Contents/MacOS/") {print $1}'
}

function wait_for_exit() {
    local attempts="${1:-60}"
    local interval="${2:-0.5}"
    local pids=""

    for ((attempt = 0; attempt < attempts; attempt++)); do
        pids="$(app_pids)"
        if [[ -z "$pids" ]]; then
            return 0
        fi

        sleep "$interval"
    done

    return 1
}

function kill_selected_app() {
    local pids=""

    pids="$(app_pids)"
    if [[ -z "$pids" ]]; then
        return 0
    fi

    echo "Quitting $app_name..."
    osascript -e "tell application \"$app_name\" to quit" >/dev/null 2>&1 || true

    if wait_for_exit 40 0.5; then
        return 0
    fi

    echo "Force stopping $app_name..."
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
    done <<< "$pids"

    if wait_for_exit 20 0.5; then
        return 0
    fi

    pids="$(app_pids)"
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
    done <<< "$pids"

    wait_for_exit 20 0.5
}

if [[ "$inject_mode" == "release" && ! -f "dist/betterdiscord.asar" ]]; then
    echo "Missing dist/betterdiscord.asar. Run ./local-build.zsh dist first."
    exit 1
fi

if [[ "$inject_mode" == "dev" && ! -f "dist/betterdiscord.js" ]]; then
    echo "Missing dist/betterdiscord.js. Run ./local-build.zsh build --module=betterdiscord first."
    exit 1
fi

inject_args=()

if [[ "$inject_mode" == "release" ]]; then
    inject_args=("release")
fi

if [[ -n "$inject_target" ]]; then
    inject_args+=("$inject_target")
fi

kill_selected_app

echo "Injecting into $app_name using $inject_mode mode..."
bun scripts/inject.ts "${inject_args[@]}"
