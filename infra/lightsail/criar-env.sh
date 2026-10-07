#!/bin/bash
# Cria o arquivo .env do servidor UMA vez: chaves novas, senha do papel da API e dados do banco e do e-mail.
# Uso (no servidor, na pasta /opt/ameta/infra/lightsail):
#   DOMINIO=controle.ametaservicos.com.br EMAIL_CERTIFICADO=ti@... \
#   DB_HOST=<banco_endereco> DB_SENHA=<banco_senha_dono> \
#   SMTP_HOST=smtp.office365.com SMTP_USUARIO=... SMTP_SENHA=... ./criar-env.sh
# As chaves não podem mudar depois (os dados pessoais ficam ilegíveis), então ele se recusa a sobrescrever.
set -euo pipefail
cd "$(dirname "$0")"
if [ -e .env ]; then
  echo "Já existe um .env aqui. Ele guarda as chaves de criptografia: não foi alterado." >&2
  exit 1
fi
for v in DOMINIO EMAIL_CERTIFICADO DB_HOST DB_SENHA SMTP_HOST; do
  if [ -z "${!v:-}" ]; then echo "Faltou $v" >&2; exit 1; fi
done
chave() { openssl rand -base64 32; }
SENHA_APP=$(openssl rand -hex 24)
DB_NOME=${DB_NOME:-ameta}
SMTP_PORTA=${SMTP_PORTA:-587}

umask 077
cat > .env <<CONF
DOMINIO=$DOMINIO
EMAIL_CERTIFICADO=$EMAIL_CERTIFICADO
NODE_ENV=production
JWT_SEGREDO=$(chave)
CHAVE_CRIPTOGRAFIA=$(chave)
CHAVE_HMAC=$(chave)
DB_HOST=$DB_HOST
DB_NOME=$DB_NOME
DB_USUARIO=${DB_USUARIO:-ameta_dono}
DB_SENHA=$DB_SENHA
DATABASE_URL_APP=postgresql://ameta_app:$SENHA_APP@$DB_HOST:5432/$DB_NOME?schema=public&sslmode=require
SMTP_HOST=$SMTP_HOST
SMTP_PORTA=$SMTP_PORTA
SMTP_SEGURO=$([ "$SMTP_PORTA" = 465 ] && echo true || echo false)
SMTP_USUARIO=${SMTP_USUARIO:-}
SMTP_SENHA=${SMTP_SENHA:-}
EMAIL_REMETENTE=${EMAIL_REMETENTE:-Controle Financeiro Ameta <nao-responda@ametaservicos.com.br>}
CONF
echo "Arquivo .env criado (só o dono do arquivo lê). Guarde uma cópia dele num cofre de senhas: sem as chaves, o backup do banco não abre."
