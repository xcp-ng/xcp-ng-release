########################################
# Prompt
########################################

# BASH : Configure things differently if current terminal has >= 8 colors.
if [ "$PS1" ] && [ $(tput colors 2>/dev/null) -ge 8 ]; then
    PS1='[\[\e[1;38;5;23m\]\D{%H:%M} \[\e[38;5;167m\]\h \[\e[m\]\W]\$ '
else
    PS1='[\D{%H:%M} \h \W]\$ '
fi

