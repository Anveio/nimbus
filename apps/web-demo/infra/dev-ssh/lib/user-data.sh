#!/usr/bin/env bash
set -euxo pipefail

dnf update -y

useradd -m nimbus || true
mkdir -p /home/nimbus/.ssh
chmod 700 /home/nimbus/.ssh

cat <<'AUTHKEY' >/home/nimbus/.ssh/authorized_keys
# Add developer keys here or upload after provisioning.
AUTHKEY

chmod 600 /home/nimbus/.ssh/authorized_keys
chown -R nimbus:nimbus /home/nimbus/.ssh

echo 'AllowUsers nimbus' >>/etc/ssh/sshd_config.d/99-nimbus.conf
systemctl restart sshd

echo 'Welcome to the Nimbus dev SSH instance.' >/etc/motd
