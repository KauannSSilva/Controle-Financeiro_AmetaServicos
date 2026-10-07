locals {
  nome = "ameta-nfse"
}

# ---------- Banco gerenciado (PostgreSQL 16, privado, backup diário + volta a qualquer minuto dos últimos 7 dias)

resource "random_password" "banco_dono" {
  length  = 32
  special = false
}

resource "aws_lightsail_database" "principal" {
  relational_database_name     = "${local.nome}-banco"
  availability_zone            = var.zona
  blueprint_id                 = "postgres_16"
  bundle_id                    = var.plano_banco
  master_database_name         = "ameta"
  master_username              = "ameta_dono"
  master_password              = random_password.banco_dono.result
  publicly_accessible          = false # só o servidor do Lightsail na mesma região alcança
  backup_retention_enabled     = true
  preferred_backup_window      = "06:00-06:30" # 03:00 em Brasília
  preferred_maintenance_window = "sun:07:00-sun:07:30"
  apply_immediately            = false
  skip_final_snapshot          = false
  final_snapshot_name          = "${local.nome}-banco-final"
}

# ---------- Servidor (Ubuntu 24.04 + Docker): Caddy (HTTPS), site (nginx) e API

resource "aws_lightsail_instance" "servidor" {
  name              = "${local.nome}-servidor"
  availability_zone = var.zona
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.plano_servidor
  ip_address_type   = "dualstack"
  user_data         = file("${path.module}/preparar-servidor.sh")

  # Cópia automática da máquina todo dia (o Lightsail guarda as 7 últimas)
  add_on {
    type          = "AutoSnapshot"
    snapshot_time = "07:00"
    status        = "Enabled"
  }
}

resource "aws_lightsail_static_ip" "servidor" {
  name = "${local.nome}-ip"
}

resource "aws_lightsail_static_ip_attachment" "servidor" {
  static_ip_name = aws_lightsail_static_ip.servidor.name
  instance_name  = aws_lightsail_instance.servidor.name
}

# Firewall do servidor: só HTTP (redireciona para HTTPS) e HTTPS abertos; SSH só pelo console do Lightsail
resource "aws_lightsail_instance_public_ports" "servidor" {
  instance_name = aws_lightsail_instance.servidor.name

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
  }
  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
  }
  port_info {
    protocol          = "tcp"
    from_port         = 22
    to_port           = 22
    cidr_list_aliases = ["lightsail-connect"]
    cidrs             = var.ip_ssh
  }
}
