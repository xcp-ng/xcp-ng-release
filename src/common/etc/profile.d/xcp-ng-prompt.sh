########################################
# Prompt
########################################

# BASH : Configure things differently if current terminal has >= 8 colors.
if which tput > /dev/null 2>&1 && [[ $(tput -T$TERM colors) -ge 8 ]]; then
    PS1=$'[\\[\e[1m\e[38;5;23m\\]\\D{%H:%M}\\[\e[m\e(B\e[39;49m\\] \\[\e[1m\e[38;5;167m\\]\\h\\[\e[m\e(B\e[39;49m\\] \\[\e[1m\e[38;5m\\]\\W\\[\e[m\e(B\e[39;49m\\]]\\$ '
else
    PS1='[\D{%H:%M} \h \W]\$ '
fi

