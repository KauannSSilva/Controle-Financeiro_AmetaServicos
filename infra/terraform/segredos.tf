# Chave KMS da Ameta: criptografa o banco, os backups e os segredos. Troca sozinha a cada ano.
resource "aws_kms_key" "principal" {
  description             = "Controle NFS-e Ameta: banco, backups e segredos"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "principal" {
  name          = "alias/${local.nome}"
  target_key_id = aws_kms_key.principal.key_id
}

# Chaves da API (32 bytes cada) e a senha do papel ameta_app. Geradas aqui, guardadas no Secrets Manager;
# ninguém precisa ver nem copiar. ATENÇÃO: trocar CHAVE_CRIPTOGRAFIA ou CHAVE_HMAC deixa os dados ilegíveis.
resource "random_id" "jwt" { byte_length = 32 }
resource "random_id" "cripto" { byte_length = 32 }
resource "random_id" "hmac" { byte_length = 32 }

resource "random_password" "banco_app" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "api" {
  name                    = "${local.nome}/api"
  description             = "Chaves da API e conexão com o papel ameta_app"
  kms_key_id              = aws_kms_key.principal.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "api" {
  secret_id = aws_secretsmanager_secret.api.id
  secret_string = jsonencode({
    JWT_SEGREDO        = random_id.jwt.b64_std
    CHAVE_CRIPTOGRAFIA = random_id.cripto.b64_std
    CHAVE_HMAC         = random_id.hmac.b64_std
    DATABASE_URL_APP   = "postgresql://ameta_app:${random_password.banco_app.result}@${aws_db_instance.principal.address}:5432/${aws_db_instance.principal.db_name}?schema=public&sslmode=require"
  })
}

# Usuário e senha do e-mail dos convites: preenchidos à mão no console (o Terraform não sobrescreve)
resource "aws_secretsmanager_secret" "smtp" {
  name                    = "${local.nome}/smtp"
  description             = "Usuário e senha do servidor de e-mail dos convites"
  kms_key_id              = aws_kms_key.principal.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "smtp" {
  secret_id     = aws_secretsmanager_secret.smtp.id
  secret_string = jsonencode({ SMTP_USUARIO = "preencher", SMTP_SENHA = "preencher" })
  lifecycle { ignore_changes = [secret_string] }
}
