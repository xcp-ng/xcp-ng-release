/sbin/update-issue && /usr/bin/killall -q -HUP mingetty agetty
kill -HUP $(cat /var/run/syslogd.pid)
