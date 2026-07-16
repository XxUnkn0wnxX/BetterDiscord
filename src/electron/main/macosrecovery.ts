export function getMacOSRecoveryEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    };

    for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "__CF_USER_TEXT_ENCODING"]) {
        if (typeof source[key] === "string" && source[key]!.length > 0) environment[key] = source[key];
    }

    return environment;
}

export function macOSRecoveryHelperSource(): string {
    return String.raw`#!/usr/bin/env -S zsh -f
emulate -LR zsh
set -u
setopt NO_RCS PIPE_FAIL
umask 077

PATH="/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

state_path="$1"
resources_path="$2"
nested_target="$3"
target_app_path="$4"
snapshot_path="$5"
ready_template_path="$6"
ready_path="$7"
disabled_path="$8"
log_path="$9"
console_log_path="$(/usr/bin/dirname "$log_path")/betterdiscord-bootstrap-console.log"
shift 9
openasar_pending_path="$1"
openasar_helper_path="$2"
openasar_helper_pid_path="$3"
installation_id="$4"
channel="$5"
armed_at="$6"
shipit_request_path="$7"
helper_pid_path="$8"
active_run_path="$9"
shift 9
run_id="$1"
stopped_helpers="$2"

app_asar="$resources_path/app.asar"
app_directory="$resources_path/app"
run_path="$(/usr/bin/dirname "$snapshot_path")"
staged_wrapper=""
ready_temporary=""
recovery_committed=0
wrapper_replacement_started=0
shipit_relaunch_disabled=0

owns_active_run() {
    [[ -f "$active_run_path" ]] || return 1
    [[ "$(/bin/cat "$active_run_path" 2>/dev/null || true)" = "$run_id" ]]
}

# A late helper from an older quit must not truncate current logs or touch the
# replacement application after a newer recovery run has superseded it.
owns_active_run || exit 0

/bin/mkdir -p "$(/usr/bin/dirname "$helper_pid_path")" 2>/dev/null || exit 1
pid_temporary="$helper_pid_path.$$.tmp"
print -r -- "$$" > "$pid_temporary" 2>/dev/null || exit 1
/bin/mv -f "$pid_temporary" "$helper_pid_path" 2>/dev/null || exit 1

/bin/mkdir -p "$(/usr/bin/dirname "$log_path")" 2>/dev/null || exit 1
: >| "$log_path" 2>/dev/null || exit 1
: >| "$console_log_path" 2>/dev/null || exit 1
exec >> "$console_log_path" 2>&1
PS4='+betterdiscord-bootstrap:%D{%Y-%m-%d %H:%M:%S %Z}:%N:%i: '
set -x

log() {
    local message="[$(/bin/date '+%Y-%m-%d %H:%M:%S %Z')] $*"
    print -r -- "$message" >> "$log_path" 2>/dev/null || true
    print -r -- "$message"
}

owned_wrapper_matches_snapshot() {
    local -a wrapper_entries
    [[ -d "$app_directory" ]] || return 1
    wrapper_entries=("$app_directory"/*(DN))
    (( $#wrapper_entries == 3 )) || return 1
    for wrapper_file in index.js package.json .betterdiscord-inject.json; do
        [[ -f "$app_directory/$wrapper_file" && -f "$snapshot_path/$wrapper_file" ]] || return 1
        /usr/bin/cmp -s "$app_directory/$wrapper_file" "$snapshot_path/$wrapper_file" || return 1
    done
}

rollback_uncommitted_wrapper() {
    (( recovery_committed == 0 )) || return 0
    [[ -n "$staged_wrapper" ]] && /bin/rm -rf "$staged_wrapper" 2>/dev/null || true
    [[ -n "$ready_temporary" ]] && /bin/rm -f "$ready_temporary" 2>/dev/null || true
    owns_active_run && /bin/rm -f "$ready_path" 2>/dev/null || true
    (( wrapper_replacement_started == 1 )) || return 0

    if [[ ! -e "$app_asar" && -f "$nested_target" ]]; then
        if [[ -e "$app_directory" ]]; then
            if owned_wrapper_matches_snapshot; then
                /bin/rm -rf "$app_directory" 2>/dev/null || true
            else
                log "Could not roll back wrapper recovery because Resources/app is no longer the owned snapshot"
                return 1
            fi
        fi
        if [[ ! -e "$app_directory" ]] && /bin/mv "$nested_target" "$app_asar" 2>/dev/null; then
            log "Rolled back the incomplete BetterDiscord wrapper to app.asar"
        elif [[ ! -e "$app_asar" ]]; then
            log "Could not roll back the incomplete BetterDiscord wrapper to app.asar"
            return 1
        fi
    fi
}

cleanup_run_state() {
    if owns_active_run; then
        /bin/rm -f "$state_path" "$active_run_path" 2>/dev/null || true
    else
        log "A newer BetterDiscord recovery run replaced active state before cleanup"
    fi
    /bin/rm -rf "$run_path" 2>/dev/null || true
}

cleanup_partial() {
    rollback_uncommitted_wrapper || true
}

cleanup_pid() {
    local recorded_pid="$(/bin/cat "$helper_pid_path" 2>/dev/null || true)"
    [[ "$recorded_pid" = "$$" ]] && /bin/rm -f "$helper_pid_path" 2>/dev/null || true
}

cleanup() {
    cleanup_partial
    cleanup_pid
}

helper_processes() {
    /bin/ps -axo pid=,pgid= 2>/dev/null || true
}

signal_helper_descendants() {
    local signal="$1"
    local process_list=""
    local child_pid=""
    local process_group=""

    process_list="$(helper_processes)"
    while read -r child_pid process_group; do
        [[ "$child_pid" = <-> && "$process_group" = "$$" && "$child_pid" != "$$" ]] || continue
        /bin/kill "-$signal" "$child_pid" 2>/dev/null || true
    done <<< "$process_list"
}

terminate_helper() {
    local status="$1"

    trap - EXIT INT TERM
    signal_helper_descendants TERM
    /bin/sleep 0.1
    signal_helper_descendants KILL
    cleanup
    exit "$status"
}

trap cleanup EXIT
trap 'terminate_helper 130' INT
trap 'terminate_helper 143' TERM

json_string_value() {
    local key="$1"
    local file="$2"
    [[ -f "$file" ]] || return 1
    BETTERDISCORD_JSON_KEY="$key" /usr/bin/perl -0ne 'BEGIN { $key = quotemeta $ENV{"BETTERDISCORD_JSON_KEY"}; } print $1 if /"$key"\s*:\s*"([^"]*)"/' "$file" 2>/dev/null
}

json_number_value() {
    local key="$1"
    local file="$2"
    [[ -f "$file" ]] || return 1
    BETTERDISCORD_JSON_KEY="$key" /usr/bin/perl -0ne 'BEGIN { $key = quotemeta $ENV{"BETTERDISCORD_JSON_KEY"}; } print $1 if /"$key"\s*:\s*(-?[0-9]+)/' "$file" 2>/dev/null
}

json_bool_true() {
    local key="$1"
    local file="$2"
    [[ -f "$file" ]] || return 1
    BETTERDISCORD_JSON_KEY="$key" /usr/bin/perl -0ne 'BEGIN { $key = quotemeta $ENV{"BETTERDISCORD_JSON_KEY"}; $found = 0; } $found = 1 if /"$key"\s*:\s*true\b/; END { exit($found ? 0 : 1) }' "$file" 2>/dev/null
}

iso_to_epoch_ms() {
    local value="$1"
    BETTERDISCORD_ISO="$value" /usr/bin/perl -MTime::Local=timegm -e '
        my $value = $ENV{"BETTERDISCORD_ISO"} // "";
        if ($value =~ /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/) {
            my ($year, $month, $day, $hour, $minute, $second, $fraction) = ($1, $2, $3, $4, $5, $6, $7 // "");
            my $millis = substr($fraction . "000", 0, 3);
            print(timegm($second, $minute, $hour, $day, $month - 1, $year) * 1000 + $millis);
            exit 0;
        }
        exit 1;
    ' 2>/dev/null
}

current_iso_time() {
    /usr/bin/perl -MTime::HiRes=gettimeofday -MPOSIX=strftime -e '
        my ($seconds, $microseconds) = gettimeofday();
        print(strftime("%Y-%m-%dT%H:%M:%S", gmtime($seconds)), sprintf(".%03dZ", int($microseconds / 1000)));
    '
}

patch_shipit_request() {
    [[ -f "$shipit_request_path" ]] || return 0
    if /usr/bin/grep -Eq '"launchAfterInstallation"[[:space:]]*:[[:space:]]*true' "$shipit_request_path" 2>/dev/null \
        && /usr/bin/perl -0pi -e 's/"launchAfterInstallation"\s*:\s*true/"launchAfterInstallation":false/g' "$shipit_request_path" 2>> "$log_path"; then
        shipit_relaunch_disabled=1
        log "Disabled ShipIt launchAfterInstallation"
    elif /usr/bin/grep -Eq '"launchAfterInstallation"[[:space:]]*:[[:space:]]*false' "$shipit_request_path" 2>/dev/null; then
        shipit_relaunch_disabled=1
    elif /usr/bin/grep -Eq '"launchAfterInstallation"[[:space:]]*:[[:space:]]*true' "$shipit_request_path" 2>/dev/null; then
        log "Could not disable ShipIt automatic relaunch"
    fi
}

openasar_helper_is_live() {
    local helper_pid="$(json_number_value helperPid "$openasar_pending_path" || true)"
    local pending_helper_path="$(json_string_value helperPath "$openasar_pending_path" || true)"
    local pending_pid_path="$(json_string_value helperPidPath "$openasar_pending_path" || true)"
    local recorded_pid=""
    local command=""

    [[ "$helper_pid" = <-> && "$helper_pid" -gt 0 ]] || return 1
    [[ "$pending_helper_path" = "$openasar_helper_path" ]] || return 1
    [[ "$pending_pid_path" = "$openasar_helper_pid_path" ]] || return 1
    recorded_pid="$(/bin/cat "$openasar_helper_pid_path" 2>/dev/null || true)"
    [[ "$recorded_pid" = "$helper_pid" ]] || return 1
    /bin/kill -0 "$helper_pid" 2>/dev/null || return 1
    command="$(/bin/ps -p "$helper_pid" -o command= 2>/dev/null || true)"
    [[ "$command" = *"$openasar_helper_path"* && "$command" = *"$openasar_helper_pid_path"* ]]
}

matching_openasar_pending() {
    local schema="$(json_number_value schema "$openasar_pending_path" || true)"
    local owner="$(json_string_value owner "$openasar_pending_path" || true)"
    local style="$(json_string_value style "$openasar_pending_path" || true)"
    local pending_channel="$(json_string_value channel "$openasar_pending_path" || true)"
    local expected_id="$(json_string_value expectedInstallationId "$openasar_pending_path" || true)"
    local expected_app="$(json_string_value appPath "$openasar_pending_path" || true)"
    local pending_nested="$(json_string_value nestedTarget "$openasar_pending_path" || true)"
    local pending_armed="$(json_string_value armedAt "$openasar_pending_path" || true)"
    local pending_epoch=""
    local now_ms="$(( $(/bin/date +%s) * 1000 ))"

    json_bool_true pending "$openasar_pending_path" || return 1
    json_bool_true betterDiscordExpected "$openasar_pending_path" || return 1
    [[ -n "$expected_id" ]] || expected_id="$(json_string_value installationId "$openasar_pending_path" || true)"
    [[ -n "$expected_app" ]] || expected_app="$(json_string_value targetAppPath "$openasar_pending_path" || true)"
    [[ -n "$expected_app" ]] || expected_app="$(json_string_value expectedTargetAppPath "$openasar_pending_path" || true)"
    [[ -n "$pending_armed" ]] || pending_armed="$(json_string_value createdAt "$openasar_pending_path" || true)"
    pending_epoch="$(iso_to_epoch_ms "$pending_armed" || true)"

    [[ "$schema" = "1" && "$owner" = "betterdiscord" && "$style" = "app-wrapper" ]] || return 1
    [[ "$pending_channel" = "$channel" && "$expected_id" = "$installation_id" ]] || return 1
    [[ "$expected_app" = "$target_app_path" && "$pending_nested" = "$nested_target" ]] || return 1
    [[ "$pending_epoch" = <-> ]] || return 1
    (( pending_epoch <= now_ms + 10000 && now_ms - pending_epoch <= 300000 )) || return 1
    openasar_helper_is_live
}

app_executable_path() {
    local info_plist="$target_app_path/Contents/Info.plist"
    local executable_name=""
    local app_name=""

    executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$info_plist" 2>/dev/null || true)"
    if [[ -z "$executable_name" ]]; then
        app_name="$(/usr/bin/basename "$target_app_path" .app 2>/dev/null || true)"
        executable_name="$app_name"
    fi

    [[ -n "$executable_name" ]] || return 1
    print -r -- "$target_app_path/Contents/MacOS/$executable_name"
}

wait_for_app_bundle_ready() {
    local deadline="$((SECONDS + 20))"
    local executable_path=""

    while (( SECONDS < deadline )); do
        owns_active_run || return 1
        [[ ! -e "$disabled_path" ]] || return 1
        executable_path="$(app_executable_path || true)"
        if [[ -f "$target_app_path/Contents/Info.plist" && -n "$executable_path" && -x "$executable_path" ]]; then
            return 0
        fi
        /bin/sleep 0.5
    done

    log "Discord app executable was not ready for relaunch at $executable_path"
    return 1
}

refresh_launch_services_registration() {
    local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

    [[ -x "$lsregister" ]] || return 0
    "$lsregister" -f "$target_app_path" >/dev/null 2>&1 || true
}

betterdiscord_owns_relaunch() {
    if ! owns_active_run; then
        log "A newer BetterDiscord recovery run owns Discord relaunch"
        return 1
    fi
    if [[ -e "$disabled_path" ]]; then
        log "Recovery disabled before Discord relaunch"
        return 1
    fi
    if matching_openasar_pending; then
        log "Matching OpenAsar handoff detected during relaunch; OpenAsar owns nested restore and relaunch"
        return 1
    fi
    return 0
}

relaunch_discord() {
    local attempt=""
    local open_output=""
    local executable_path=""

    log "No matching OpenAsar handoff; BetterDiscord owns relaunch"
    if [[ ! -d "$target_app_path" ]]; then
        log "Discord app is not available for relaunch at $target_app_path"
        return 0
    fi
    wait_for_app_bundle_ready || return 1

    for attempt in 1 2 3; do
        betterdiscord_owns_relaunch || return 0
        refresh_launch_services_registration
        if open_output="$(/usr/bin/open "$target_app_path" 2>&1)"; then
            log "Relaunched Discord $target_app_path"
            return 0
        fi
        if [[ -n "$open_output" ]]; then
            log "Discord open attempt $attempt failed for $target_app_path: $open_output"
        else
            log "Discord open attempt $attempt failed for $target_app_path"
        fi
        /bin/sleep 1
    done

    betterdiscord_owns_relaunch || return 0
    executable_path="$(app_executable_path || true)"
    if [[ -n "$executable_path" && -x "$executable_path" ]]; then
        log "Falling back to direct Discord executable launch $executable_path"
        "$executable_path" >/dev/null 2>&1 &!
        return 0
    fi

    log "Discord relaunch failed for $target_app_path"
    return 1
}

handoff_or_relaunch_after_failure() {
    if matching_openasar_pending; then
        log "Matching OpenAsar handoff remains active after BetterDiscord recovery failure"
    elif (( shipit_relaunch_disabled == 1 )); then
        relaunch_discord
    fi
}

fail_recovery() {
    log "Wrapper recovery failed: $*"
    if rollback_uncommitted_wrapper; then
        handoff_or_relaunch_after_failure
    else
        log "Withholding handoff and relaunch because the application layout could not be rolled back safely"
    fi
    exit 1
}

[[ -n "$stopped_helpers" ]] || stopped_helpers="none"
log "Recovery helper started pid=$$ pidFile=$helper_pid_path installationId=$installation_id channel=$channel armedAt=$armed_at supersededPids=$stopped_helpers"
patch_shipit_request

last_size=""
stable_polls=0
deadline="$((SECONDS + 90))"
while (( SECONDS < deadline )); do
    owns_active_run || exit 0
    if [[ -e "$disabled_path" ]]; then
        log "Recovery disabled by deliberate uninject; exiting"
        exit 0
    fi
    patch_shipit_request

    size="$(/usr/bin/stat -f%z "$app_asar" 2>/dev/null || true)"
    if [[ -n "$size" && "$size" != "0" && "$size" = "$last_size" ]]; then
        stable_polls="$((stable_polls + 1))"
    else
        stable_polls=0
    fi
    last_size="$size"
    (( stable_polls >= 3 )) && break
    /bin/sleep 0.25
done

if (( stable_polls < 3 )); then
    log "No Discord update detected before timeout; leaving the existing BetterDiscord wrapper unchanged"
    recovery_committed=1
    cleanup_run_state
    exit 0
fi

owns_active_run || exit 0
if [[ -e "$disabled_path" ]]; then
    log "Recovery disabled before wrapper replacement; exiting"
    exit 0
fi
if [[ -e "$app_directory" || -e "$nested_target" ]]; then
    fail_recovery "fresh resources layout is ambiguous"
fi
for snapshot_file in index.js package.json .betterdiscord-inject.json; do
    if [[ ! -f "$snapshot_path/$snapshot_file" ]]; then
        fail_recovery "snapshot is missing $snapshot_file"
    fi
done

owns_active_run || exit 0
if [[ -e "$disabled_path" ]]; then
    log "Recovery disabled immediately before wrapper replacement; exiting"
    exit 0
fi
staged_wrapper="$resources_path/.betterdiscord-app-helper-$$"
wrapper_replacement_started=1
if ! /bin/mv "$app_asar" "$nested_target"; then
    fail_recovery "could not move fresh app.asar"
fi

if ! /bin/mkdir "$staged_wrapper" \
    || ! /bin/cp "$snapshot_path/index.js" "$staged_wrapper/index.js" \
    || ! /bin/cp "$snapshot_path/package.json" "$staged_wrapper/package.json" \
    || ! /bin/cp "$snapshot_path/.betterdiscord-inject.json" "$staged_wrapper/.betterdiscord-inject.json" \
    || ! /bin/mv "$staged_wrapper" "$app_directory"; then
    fail_recovery "could not install the BetterDiscord wrapper"
fi
staged_wrapper=""

owns_active_run || exit 0
if [[ -e "$disabled_path" ]]; then
    log "Recovery disabled after wrapper replacement; withholding ready handoff"
    exit 0
fi
ready_at="$(current_iso_time)"
[[ -n "$ready_at" ]] || fail_recovery "could not generate wrapper-ready timestamp"
ready_temporary="$ready_path.$$.tmp"
if ! /bin/cp "$ready_template_path" "$ready_temporary" \
    || ! BETTERDISCORD_READY_AT="$ready_at" /usr/bin/perl -0pi -e 'BEGIN { $value = $ENV{"BETTERDISCORD_READY_AT"}; } s/"readyAt"\s*:\s*""/"readyAt": "$value"/ or die "readyAt placeholder missing";' "$ready_temporary" \
    || ! /bin/mv -f "$ready_temporary" "$ready_path"; then
    fail_recovery "wrapper-ready marker creation failed"
fi
ready_temporary=""

owns_active_run || exit 0
if [[ -e "$disabled_path" ]]; then
    /bin/rm -f "$ready_path" 2>/dev/null || true
    log "Recovery disabled before OpenAsar handoff; removed wrapper-ready marker"
    exit 0
fi
log "Wrapper ready for installation $installation_id"
relaunch_failed=0
if matching_openasar_pending; then
    log "Matching OpenAsar handoff detected; OpenAsar owns nested restore and relaunch"
else
    relaunch_discord || relaunch_failed=1
fi
recovery_committed=1
cleanup_run_state
if (( relaunch_failed == 1 )); then
    log "Wrapper recovery committed, but Discord relaunch did not start"
    exit 1
fi
exit 0
`;
}
