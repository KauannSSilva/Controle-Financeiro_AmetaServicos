# PostgreSQL 16 privado: sem endereço público, TLS obrigatório, disco e backups criptografados,
# backup automático diário guardado por 14 dias e proteção contra exclusão.

resource "aws_db_subnet_group" "principal" {
  name       = local.nome
  subnet_ids = aws_subnet.privada[*].id
}

resource "aws_db_parameter_group" "principal" {
  name   = "${local.nome}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "2000" # consultas acima de 2 s vão para o log
  }
  parameter {
    name  = "timezone"
    value = "America/Sao_Paulo"
  }
}

resource "aws_db_instance" "principal" {
  identifier     = local.nome
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.banco_classe
  multi_az       = var.banco_multi_az

  db_name  = "ameta"
  username = "ameta_dono"
  # A senha do dono fica no Secrets Manager, gerada e trocada pelo próprio RDS (não passa pelo Terraform)
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.principal.arn

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.principal.arn

  db_subnet_group_name   = aws_db_subnet_group.principal.name
  vpc_security_group_ids = [aws_security_group.banco.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.principal.name

  backup_retention_period         = 14
  backup_window                   = "06:00-07:00" # 03h–04h em Brasília
  maintenance_window              = "sun:07:00-sun:08:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.nome}-final"
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
}
