# Alarmes por e-mail: site fora do ar, erros na API, banco sobrecarregado ou sem espaço.

resource "aws_sns_topic" "alertas" {
  name = "${local.nome}-alertas"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alertas.arn
  protocol  = "email"
  endpoint  = var.email_alertas
}

# Erros internos da API (nível 50 nos logs) viram uma métrica
resource "aws_cloudwatch_log_metric_filter" "erros_api" {
  name           = "erros-internos"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.level >= 50 }"
  metric_transformation {
    name          = "ErrosInternos"
    namespace     = "AmetaNFSe"
    value         = "1"
    default_value = "0"
  }
}

locals {
  alarmes = {
    api-sem-tarefa-saudavel = {
      descricao  = "Nenhuma cópia da API respondendo: o site está fora do ar"
      namespace  = "AWS/ApplicationELB", metrica = "HealthyHostCount", estatistica = "Minimum"
      comparacao = "LessThanThreshold", limite = 1, periodos = 2
      dimensoes  = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
    }
    api-erros-5xx = {
      descricao  = "A API devolveu 5 ou mais erros 5xx em 5 minutos"
      namespace  = "AWS/ApplicationELB", metrica = "HTTPCode_Target_5XX_Count", estatistica = "Sum"
      comparacao = "GreaterThanOrEqualToThreshold", limite = 5, periodos = 1
      dimensoes  = { LoadBalancer = aws_lb.api.arn_suffix }
    }
    api-erros-internos = {
      descricao  = "Erros internos registrados nos logs da API"
      namespace  = "AmetaNFSe", metrica = "ErrosInternos", estatistica = "Sum"
      comparacao = "GreaterThanOrEqualToThreshold", limite = 3, periodos = 1
      dimensoes  = {}
    }
    banco-cpu-alta = {
      descricao  = "Banco com CPU acima de 80% por 15 minutos"
      namespace  = "AWS/RDS", metrica = "CPUUtilization", estatistica = "Average"
      comparacao = "GreaterThanThreshold", limite = 80, periodos = 3
      dimensoes  = { DBInstanceIdentifier = aws_db_instance.principal.identifier }
    }
    banco-pouco-espaco = {
      descricao  = "Banco com menos de 2 GB livres"
      namespace  = "AWS/RDS", metrica = "FreeStorageSpace", estatistica = "Minimum"
      comparacao = "LessThanThreshold", limite = 2 * 1024 * 1024 * 1024, periodos = 1
      dimensoes  = { DBInstanceIdentifier = aws_db_instance.principal.identifier }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "alarmes" {
  for_each            = local.alarmes
  alarm_name          = "${local.nome}-${each.key}"
  alarm_description   = each.value.descricao
  namespace           = each.value.namespace
  metric_name         = each.value.metrica
  statistic           = each.value.estatistica
  comparison_operator = each.value.comparacao
  threshold           = each.value.limite
  evaluation_periods  = each.value.periodos
  period              = 300
  dimensions          = each.value.dimensoes
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alertas.arn]
  ok_actions          = [aws_sns_topic.alertas.arn]
}
