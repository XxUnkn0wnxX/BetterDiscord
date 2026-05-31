#!/usr/bin/env zsh

set -euo pipefail

repo_dir="${0:A:h}"
cd "$repo_dir"

target="${1:-}"
inject_mode="${2:-auto}"

if [[ "$#" -gt 2 ]]; then
    echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev]"
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
    auto|release|dev)
        ;;
    *)
        echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev]"
        exit 1
        ;;
esac

case "$target" in
    stable|discord)
        app_name="Discord"
        release_dir="discord"
        ;;
    ptb)
        app_name="Discord PTB"
        release_dir="discordptb"
        ;;
    canary)
        app_name="Discord Canary"
        release_dir="discordcanary"
        ;;
    *)
        echo "Usage: ./local-uninject.zsh [stable|ptb|canary] [auto|release|dev]"
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

function stop_selected_app() {
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

function compare_versions() {
    local left="$1"
    local right="$2"
    local -a left_parts right_parts
    local max_length=0
    local index=1
    local left_part=0
    local right_part=0

    left_parts=("${(@s:.:)left}")
    right_parts=("${(@s:.:)right}")

    max_length="${#left_parts[@]}"
    if (( ${#right_parts[@]} > max_length )); then
        max_length="${#right_parts[@]}"
    fi

    while (( index <= max_length )); do
        left_part="${left_parts[index]:-0}"
        right_part="${right_parts[index]:-0}"

        if (( left_part > right_part )); then
            return 1
        fi

        if (( left_part < right_part )); then
            return 2
        fi

        ((index++))
    done

    return 0
}

function get_preferred_version_directory() {
    local basedir="$1"
    local best_entry=""
    local best_version=""
    local comparison=0
    local entry=""
    local entry_name=""
    local version=""
    local -a entries

    setopt local_options null_glob
    entries=("$basedir"/*(/N))

    for entry in "${entries[@]}"; do
        entry_name="${entry:t}"
        version="$entry_name"

        if [[ "$entry_name" == app-* ]]; then
            version="${entry_name#app-}"
        fi

        [[ "$version" == *.* ]] || continue

        if [[ -z "$best_entry" ]]; then
            best_entry="$entry_name"
            best_version="$version"
            continue
        fi

        set +e
        compare_versions "$version" "$best_version"
        comparison="$?"
        set -e

        case "$comparison" in
            1)
                best_entry="$entry_name"
                best_version="$version"
                ;;
            0)
                if [[ "$entry_name" == app-* && "$best_entry" != app-* ]]; then
                    best_entry="$entry_name"
                    best_version="$version"
                fi
                ;;
        esac
    done

    [[ -n "$best_entry" ]] && printf "%s\n" "$best_entry"
}

function resolve_desktop_core() {
    local modules_path="$1"
    local best_wrapped=""
    local best_suffix=-1
    local entry=""
    local suffix=""
    local candidate=""

    [[ -d "$modules_path" ]] || return 1

    setopt local_options null_glob
    for entry in "$modules_path"/discord_desktop_core-*(/N); do
        suffix="${${entry:t}#discord_desktop_core-}"
        if [[ "$suffix" == <-> ]] && (( suffix > best_suffix )); then
            best_wrapped="$entry"
            best_suffix="$suffix"
        fi
    done

    if [[ -n "$best_wrapped" ]]; then
        candidate="$best_wrapped/discord_desktop_core"
        [[ -d "$candidate" ]] && printf "%s\n" "$candidate" && return 0
    fi

    candidate="$modules_path/discord_desktop_core"
    [[ -d "$candidate" ]] && printf "%s\n" "$candidate" && return 0

    return 1
}

function get_discord_core_path() {
    local user_data="$HOME/.config"
    local basedir=""
    local version_dir=""
    local modules_path=""

    if [[ "$OSTYPE" == darwin* ]]; then
        user_data="$HOME/Library/Application Support"
    elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
        user_data="$XDG_CONFIG_HOME"
    fi

    basedir="$user_data/$release_dir"
    [[ -d "$basedir" ]] || return 1

    version_dir="$(get_preferred_version_directory "$basedir")"
    [[ -n "$version_dir" ]] || return 1

    modules_path="$basedir/$version_dir/modules"
    resolve_desktop_core "$modules_path"
}

stop_selected_app

discord_core_path="$(get_discord_core_path || true)"
if [[ -z "$discord_core_path" || ! -d "$discord_core_path" ]]; then
    echo "Cannot find directory for $app_name."
    exit 1
fi

index_js="$discord_core_path/index.js"
if [[ ! -f "$index_js" ]]; then
    echo "Cannot find index.js for $app_name."
    exit 1
fi

stock_loader='module.exports = require("./core.asar");'
current_contents="$(<"$index_js")"
release_marker='require("./betterdiscord.asar");'
release_marker_absolute='/dist/betterdiscord.asar'
dev_marker_absolute='/dist'
dev_marker_relative='require("./betterdiscord");'

if [[ "$current_contents" == "$stock_loader" || "$current_contents" == "$stock_loader"$'\n' ]]; then
    echo "$app_name is already using the stock loader."
    exit 0
fi

if [[ "$inject_mode" == "release" && "$current_contents" != *"$release_marker"* && "$current_contents" != *"$release_marker_absolute"* ]]; then
    echo "Refusing to uninject $app_name as release mode because index.js does not look like release injection."
    exit 1
fi

if [[ "$inject_mode" == "dev" && "$current_contents" != *"$dev_marker_absolute"* && "$current_contents" != *"$dev_marker_relative"* ]]; then
    echo "Refusing to uninject $app_name as dev mode because index.js does not look like dev injection."
    exit 1
fi

if [[ "$current_contents" != *"betterdiscord"* && "$current_contents" != *'require("./core.asar")'* ]]; then
    echo "Refusing to overwrite unexpected index.js contents in $index_js"
    exit 1
fi

printf '%s\n' "$stock_loader" > "$index_js"

echo "Uninjected $app_name (${inject_mode} mode)."
echo "    ✅ Restored stock loader in $index_js"
