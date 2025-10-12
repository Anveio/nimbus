#!/usr/bin/env bash
set -euxo pipefail

dnf update -y

TESTING_USER="${MANA_TESTING_USER:-mana-integ}"

if ! id "$TESTING_USER" &>/dev/null; then
  useradd -m "$TESTING_USER"
fi

mkdir -p "/home/${TESTING_USER}/.ssh"
chmod 700 "/home/${TESTING_USER}/.ssh"
touch "/home/${TESTING_USER}/.hushlogin"

cat <<'MOTD' >/etc/motd
Instance Connect testing target for Nimbus. Credentials are delivered via EC2 Instance Connect helper tooling.
MOTD

echo "AllowUsers ${TESTING_USER}" >/etc/ssh/sshd_config.d/99-mana-testing.conf
systemctl restart sshd
