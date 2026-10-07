#!/bin/bash
# Roda uma vez, quando o servidor é criado: Docker, atualizações de segurança automáticas e o código do sistema.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# 2 GB de swap: dá folga para montar as imagens no próprio servidor
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl git unattended-upgrades

# Docker oficial (com o compose)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu

# Atualizações de segurança do sistema todo dia, reiniciando de madrugada se precisar
cat > /etc/apt/apt.conf.d/52ameta <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
CONF
systemctl enable --now unattended-upgrades

# Código do sistema (o repositório é público; nenhum segredo vem junto)
if [ ! -d /opt/ameta ]; then
  git clone https://github.com/KauannSSilva/Controle-Financeiro_AmetaServicos.git /opt/ameta
  chown -R ubuntu:ubuntu /opt/ameta
fi
