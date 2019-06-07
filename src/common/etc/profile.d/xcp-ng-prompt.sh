########################################
# Prompt
########################################

# BASH : Configure things differently if current terminal has >= 8 colors.
if which tput > /dev/null 2>&1 && [[ $(tput colors) -ge 8 ]]; then
    PS1='[\[\e[1;38;5;23m\]\D{%H:%M} \[\e[38;5;167m\]\h \[\e[m\]\W]\$ '
else
    PS1='[\D{%H:%M} \h \W]\$ '
fi

