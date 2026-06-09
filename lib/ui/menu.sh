# shellcheck shell=bash
# Interactive UI primitives (pure Bash, no external deps).
# Requires lib/ui/colors.sh to be sourced first.

# ork_menu PROMPT OUTVAR OPTION...
# Arrow-key selectable menu. Falls back to numbered prompt on non-TTY.
ork_menu() {
    local prompt="$1" outvar="$2"; shift 2
    local options=("$@") count=${#options[@]} cur=0 key esc

    if [[ ! -t 0 || ! -t 1 ]]; then
        # Non-interactive: numbered fallback.
        printf "%s\n" "$prompt"
        local i=1
        for o in "${options[@]}"; do printf "  %d) %s\n" "$i" "$o"; i=$((i+1)); done
        printf "Select [1-%d]: " "$count"
        local sel; read -r sel
        sel="${sel:-1}"
        (( sel >= 1 && sel <= count )) || ork_die "Invalid selection"
        printf -v "$outvar" "%s" "${options[$((sel-1))]}"
        return
    fi

    esc=$(printf "\033")
    printf "%s%s%s%s\n" "$ORK_GREEN" "$ORK_BOLD" "$prompt" "$ORK_NC"
    printf "\033[?25l"  # hide cursor

    while true; do
        local i=0
        for o in "${options[@]}"; do
            if [[ $i -eq $cur ]]; then
                printf "  %s%s> %s%s\033[K\n" "$ORK_CYAN" "$ORK_BOLD" "$o" "$ORK_NC"
            else
                printf "    %s\033[K\n" "$o"
            fi
            i=$((i+1))
        done

        IFS= read -rsn1 key
        if [[ "$key" == "$esc" ]]; then
            IFS= read -rsn2 key
            if   [[ "$key" == "[A" ]]; then cur=$(( cur > 0 ? cur-1 : count-1 ));
            elif [[ "$key" == "[B" ]]; then cur=$(( cur < count-1 ? cur+1 : 0 ));
            fi
        elif [[ -z "$key" ]]; then
            break
        fi
        printf "\033[%dA" "$count"
    done

    printf "\033[?25h"
    printf -v "$outvar" "%s" "${options[$cur]}"
}

# ork_multiselect PROMPT OUTVAR OPTION...
# Space toggles, Enter confirms. Result is a newline-separated list in OUTVAR.
ork_multiselect() {
    local prompt="$1" outvar="$2"; shift 2
    local options=("$@") count=${#options[@]} cur=0 key esc
    local -a selected
    local i; for ((i=0; i<count; i++)); do selected[i]=0; done

    if [[ ! -t 0 || ! -t 1 ]]; then
        printf "%s (comma-separated indices, e.g. 1,3):\n" "$prompt"
        i=1; for o in "${options[@]}"; do printf "  %d) %s\n" "$i" "$o"; i=$((i+1)); done
        printf "> "
        local raw; read -r raw
        local out=""
        IFS=',' read -ra picks <<< "$raw"
        for p in "${picks[@]}"; do
            p="${p// /}"
            [[ -z "$p" ]] && continue
            (( p >= 1 && p <= count )) || ork_die "Invalid selection: $p"
            out+="${options[$((p-1))]}"$'\n'
        done
        printf -v "$outvar" "%s" "$out"
        return
    fi

    esc=$(printf "\033")
    printf "%s%s%s%s  %s(space=toggle, enter=confirm)%s\n" \
        "$ORK_GREEN" "$ORK_BOLD" "$prompt" "$ORK_NC" "$ORK_DIM" "$ORK_NC"
    printf "\033[?25l"

    while true; do
        for ((i=0; i<count; i++)); do
            local mark="[ ]"; [[ ${selected[i]} -eq 1 ]] && mark="[x]"
            if [[ $i -eq $cur ]]; then
                printf "  %s%s> %s %s%s\033[K\n" "$ORK_CYAN" "$ORK_BOLD" "$mark" "${options[i]}" "$ORK_NC"
            else
                printf "    %s %s\033[K\n" "$mark" "${options[i]}"
            fi
        done

        IFS= read -rsn1 key
        if [[ "$key" == "$esc" ]]; then
            IFS= read -rsn2 key
            if   [[ "$key" == "[A" ]]; then cur=$(( cur > 0 ? cur-1 : count-1 ));
            elif [[ "$key" == "[B" ]]; then cur=$(( cur < count-1 ? cur+1 : 0 ));
            fi
        elif [[ "$key" == " " ]]; then
            selected[cur]=$(( 1 - selected[cur] ))
        elif [[ -z "$key" ]]; then
            break
        fi
        printf "\033[%dA" "$count"
    done

    printf "\033[?25h"
    local out=""
    for ((i=0; i<count; i++)); do
        [[ ${selected[i]} -eq 1 ]] && out+="${options[i]}"$'\n'
    done
    printf -v "$outvar" "%s" "$out"
}

# ork_confirm PROMPT [default-yes|default-no]
# Returns 0 for yes, 1 for no. Honors ORK_YES=1 (auto-confirm).
ork_confirm() {
    local prompt="$1" default="${2:-default-no}" hint="[y/N]"
    [[ "$default" == "default-yes" ]] && hint="[Y/n]"
    if [[ "${ORK_YES:-0}" == "1" ]]; then
        ork_dim "$prompt $hint  → auto-yes"
        return 0
    fi
    local ans
    printf "%s%s%s %s " "$ORK_GREEN" "$prompt" "$ORK_NC" "$hint"
    read -r ans
    ans="${ans:-}"
    case "$ans" in
        y|Y|yes|YES) return 0 ;;
        n|N|no|NO)   return 1 ;;
        "")          [[ "$default" == "default-yes" ]] && return 0 || return 1 ;;
        *)           return 1 ;;
    esac
}

# ork_prompt PROMPT OUTVAR [DEFAULT]
ork_prompt() {
    local prompt="$1" outvar="$2" def="${3:-}"
    local hint=""; [[ -n "$def" ]] && hint=" ($def)"
    printf "%s%s%s%s: " "$ORK_GREEN" "$prompt" "$hint" "$ORK_NC"
    local ans; read -r ans
    [[ -z "$ans" ]] && ans="$def"
    printf -v "$outvar" "%s" "$ans"
}
