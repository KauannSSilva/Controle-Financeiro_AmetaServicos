# API em contêiner (ECS Fargate) atrás de um balanceador (ALB) que só aceita o CloudFront.

resource "aws_ecr_repository" "api" {
  for_each             = toset(["api", "migracao"])
  name                 = "${local.nome}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.principal.arn
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  for_each   = aws_ecr_repository.api
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1, description = "Guarda as 20 imagens mais novas"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/${local.nome}/api"
  retention_in_days = 90
}

resource "aws_cloudwatch_log_group" "tarefas" {
  name              = "/${local.nome}/tarefas"
  retention_in_days = 90
}

resource "aws_ecs_cluster" "principal" {
  name = local.nome
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Papel usado pelo ECS para baixar a imagem, ler os segredos e gravar os logs
data "aws_iam_policy_document" "assumir_ecs" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execucao" {
  name               = "${local.nome}-execucao"
  assume_role_policy = data.aws_iam_policy_document.assumir_ecs.json
}

resource "aws_iam_role_policy_attachment" "execucao_padrao" {
  role       = aws_iam_role.execucao.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ler_segredos" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.api.arn,
      aws_secretsmanager_secret.smtp.arn,
      aws_db_instance.principal.master_user_secret[0].secret_arn,
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.principal.arn]
  }
}

resource "aws_iam_role_policy" "execucao_segredos" {
  role   = aws_iam_role.execucao.id
  policy = data.aws_iam_policy_document.ler_segredos.json
}

# Papel da própria API: não precisa de nenhuma permissão na AWS
resource "aws_iam_role" "tarefa" {
  name               = "${local.nome}-tarefa"
  assume_role_policy = data.aws_iam_policy_document.assumir_ecs.json
}

locals {
  segredo_api  = aws_secretsmanager_secret.api.arn
  segredo_smtp = aws_secretsmanager_secret.smtp.arn
  segredo_dono = aws_db_instance.principal.master_user_secret[0].secret_arn
  imagem       = { for k, r in aws_ecr_repository.api : k => "${r.repository_url}:${var.versao_api}" }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.nome}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execucao.arn
  task_role_arn            = aws_iam_role.tarefa.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  volume { name = "tmp" }

  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.imagem["api"]
    essential              = true
    readonlyRootFilesystem = true
    user                   = "65532"
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "API_PORTA", value = "3000" },
      { name = "ORIGEM_FRONT", value = "https://${var.dominio}" },
      { name = "URL_SITE", value = "https://${var.dominio}" },
      { name = "CONFIAR_PROXY", value = "2" }, # CloudFront + ALB
      { name = "COOKIE_SEGURO", value = "true" },
      { name = "SMTP_HOST", value = var.smtp_host },
      { name = "SMTP_PORTA", value = tostring(var.smtp_porta) },
      { name = "SMTP_SEGURO", value = var.smtp_porta == 465 ? "true" : "false" },
      { name = "EMAIL_REMETENTE", value = var.email_remetente },
    ]
    secrets = concat(
      [for k in ["JWT_SEGREDO", "CHAVE_CRIPTOGRAFIA", "CHAVE_HMAC", "DATABASE_URL_APP"] : { name = k, valueFrom = "${local.segredo_api}:${k}::" }],
      [for k in ["SMTP_USUARIO", "SMTP_SENHA"] : { name = k, valueFrom = "${local.segredo_smtp}:${k}::" }],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.regiao
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

# Tarefas avulsas com o usuário dono do banco (api/scripts/producao.mjs): migrações e papel ameta_app
# (padrão), primeiro ADMIN e importação da planilha no dia da troca
resource "aws_ecs_task_definition" "tarefas" {
  family                   = "${local.nome}-tarefas"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execucao.arn
  task_role_arn            = aws_iam_role.tarefa.arn

  container_definitions = jsonencode([{
    name      = "migracao"
    image     = local.imagem["migracao"]
    essential = true
    environment = [
      { name = "DB_HOST", value = aws_db_instance.principal.address },
      { name = "DB_NOME", value = aws_db_instance.principal.db_name },
    ]
    secrets = concat([
      { name = "DB_USUARIO", valueFrom = "${local.segredo_dono}:username::" },
      { name = "DB_SENHA", valueFrom = "${local.segredo_dono}:password::" },
    ], [for k in ["JWT_SEGREDO", "CHAVE_CRIPTOGRAFIA", "CHAVE_HMAC", "DATABASE_URL_APP"] : { name = k, valueFrom = "${local.segredo_api}:${k}::" }])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.tarefas.name
        awslogs-region        = var.regiao
        awslogs-stream-prefix = "tarefas"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                   = "api"
  cluster                = aws_ecs_cluster.principal.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_tarefas
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.publica[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true # só para sair (ECR, e-mail); a entrada é bloqueada pelo grupo de segurança
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Versão nova que não fica saudável volta sozinha para a anterior
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  depends_on                         = [aws_lb_listener.https]
}

# ---------- Balanceador ----------

resource "aws_acm_certificate" "origem" {
  domain_name       = local.dominio_origem
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validacao_origem" {
  for_each = { for o in aws_acm_certificate.origem.domain_validation_options : o.domain_name => o }
  zone_id  = data.aws_route53_zone.principal.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}

resource "aws_acm_certificate_validation" "origem" {
  certificate_arn         = aws_acm_certificate.origem.arn
  validation_record_fqdns = [for r in aws_route53_record.validacao_origem : r.fqdn]
}

resource "aws_lb" "api" {
  name                       = local.nome
  load_balancer_type         = "application"
  subnets                    = aws_subnet.publica[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.nome}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.principal.id
  deregistration_delay = 30
  health_check {
    path                = "/api/v1/saude"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Segredo que o CloudFront manda em todo pedido: sem ele o ALB responde 403 (ninguém fura o WAF indo direto ao ALB)
resource "random_password" "cabecalho_origem" {
  length  = 48
  special = false
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.origem.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"erro\":\"Não encontrado\"}"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    http_header {
      http_header_name = "X-Origem-Ameta"
      values           = [random_password.cabecalho_origem.result]
    }
  }
  condition {
    path_pattern { values = ["/api/*"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_route53_record" "origem" {
  zone_id = data.aws_route53_zone.principal.zone_id
  name    = local.dominio_origem
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = false
  }
}
