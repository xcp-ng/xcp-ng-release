########################################
# Prompt
########################################

# BASH : Configure things differently if current terminal has >= 8 colors.
if [ "$PS1" ] && [ $(tput colors 2>/dev/null) -ge 8 ]; then
    PS1='\[\e[0;38;5;160m\][\[\e[0;2m\]\A \[\e[0;1;38;5;105m\]\h \[\e[0m\]\W\[\e[0;38;5;160m\]]\[\e[0m\]\$ '
else
    PS1='[\A \h \W]\$ '
fi

