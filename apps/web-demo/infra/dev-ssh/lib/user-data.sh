#!/usr/bin/env bash
set -euxo pipefail

dnf update -y

useradd -m mana || true
mkdir -p /home/mana/.ssh
chmod 700 /home/mana/.ssh

cat <<'AUTHKEY' >/home/mana/.ssh/authorized_keys
# Add developer keys here or upload after provisioning.
AUTHKEY

chmod 600 /home/mana/.ssh/authorized_keys
chown -R mana:mana /home/mana/.ssh

echo 'AllowUsers mana' >>/etc/ssh/sshd_config.d/99-mana.conf
systemctl restart sshd

echo 'Welcome to the Nimbus dev SSH instance.' >/etc/motd
