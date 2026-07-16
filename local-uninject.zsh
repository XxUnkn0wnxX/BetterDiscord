#!/usr/bin/env zsh

set -euo pipefail

repo_dir="${0:A:h}"
cd "$repo_dir"

dry_run=false
positional=()
for argument in "$@"; do
    if [[ "$argument" == "--dry-run" ]]; then
        dry_run=true
    else
        positional+=("$argument")
    fi
done

target="${positional[1]:-}"
inject_mode="${positional[2]:-auto}"

if [[ "${#positional[@]}" -gt 2 ]]; then
    echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev] [--dry-run]"
    exit 1
fi

if [[ -z "$target" ]]; then
    echo "Select Discord channel to uninject:"
    echo "  1) stable"
    echo "  2) ptb"
    echo "  3) canary"
    printf "Choice [1-3]: "
    read -r selection

    case "$selection" in
        1|stable) target="stable" ;;
        2|ptb) target="ptb" ;;
        3|canary) target="canary" ;;
        *)
            echo "Invalid selection."
            exit 1
            ;;
    esac
fi

case "$inject_mode" in
    auto|release|dev) ;;
    *)
        echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev] [--dry-run]"
        exit 1
        ;;
esac

case "$target" in
    stable|discord)
        target="stable"
        app_name="Discord"
        data_name="discord"
        ;;
    ptb)
        app_name="Discord PTB"
        data_name="discordptb"
        ;;
    canary)
        app_name="Discord Canary"
        data_name="discordcanary"
        ;;
    *)
        echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev] [--dry-run]"
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
        [[ -z "$pids" ]] && return 0
        sleep "$interval"
    done
    return 1
}

function stop_selected_app() {
    local pids=""

    pids="$(app_pids)"
    [[ -z "$pids" ]] && return 0

    echo "Quitting $app_name..."
    osascript -e "tell application \"$app_name\" to quit" >/dev/null 2>&1 || true
    wait_for_exit 40 0.5 && return 0

    echo "Force stopping $app_name..."
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
    done <<< "$pids"
    wait_for_exit 20 0.5 && return 0

    pids="$(app_pids)"
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
    done <<< "$pids"
    wait_for_exit 20 0.5
}

recovery_disabled="$HOME/Library/Application Support/$data_name/betterdiscord-bootstrap/recovery-disabled"
wrapper_marker="/Applications/$app_name.app/Contents/Resources/app/.betterdiscord-inject.json"
wrapped_asar="/Applications/$app_name.app/Contents/Resources/betterdiscord.app.asar"
prepared_recovery=false
recovery_preexisting=false

function rollback_prepared_recovery() {
    local status=$?
    trap - EXIT

    if (( status != 0 )) && [[ "$prepared_recovery" == true && -f "$wrapper_marker" && -f "$wrapped_asar" ]]; then
        rm -f -- "$recovery_disabled" || true
        echo "Re-enabled BetterDiscord update recovery because uninject did not complete."
    fi

    return "$status"
}

if [[ "$dry_run" == true ]]; then
    echo "Dry-run: inspecting $app_name; no files or processes will be changed..."
    bun scripts/uninject.ts "$target" "$inject_mode" --dry-run
    exit 0
fi

# Confirm a complete BetterDiscord-owned wrapper exists before disabling
# recovery or stopping Discord. Exit code 3 means the stock layout is already
# present, so uninject is a successful no-op.
if bun scripts/uninject.ts "$target" "$inject_mode" --check; then
    :
else
    check_status=$?
    if (( check_status == 3 )); then
        exit 0
    fi
    exit "$check_status"
fi

# Disable the detached macOS recovery helper before quitting Discord so a
# deliberate uninject cannot be mistaken for an application update.
[[ -e "$recovery_disabled" || -L "$recovery_disabled" ]] && recovery_preexisting=true
trap rollback_prepared_recovery EXIT
bun scripts/uninject.ts "$target" "$inject_mode" --prepare
if [[ "$recovery_preexisting" == false && -f "$recovery_disabled" ]]; then
    prepared_recovery=true
fi
stop_selected_app
bun scripts/uninject.ts "$target" "$inject_mode"
prepared_recovery=false
trap - EXIT
