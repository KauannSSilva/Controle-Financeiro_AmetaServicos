# AWS WAF na borda (CloudFront): regras gerenciadas da AWS + limite de pedidos por IP.

resource "aws_wafv2_web_acl" "borda" {
  provider = aws.us_east_1
  name     = "${local.nome}-borda"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Login, MFA e confirmações: no máximo 100 pedidos por IP a cada 5 minutos
  rule {
    name     = "limite-login"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 100
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/v1/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-login"
      sampled_requests_enabled   = true
    }
  }

  # Qualquer rota: 2.000 pedidos por IP a cada 5 minutos
  rule {
    name     = "limite-geral"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-geral"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = {
      AWSManagedRulesAmazonIpReputationList = 10
      AWSManagedRulesCommonRuleSet          = 11
      AWSManagedRulesKnownBadInputsRuleSet  = 12
      AWSManagedRulesSQLiRuleSet            = 13
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
          # A API aceita corpos de até 100 KB; a regra genérica bloquearia acima de 8 KB
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.nome}-borda"
    sampled_requests_enabled   = true
  }
}

# Pedidos bloqueados ficam registrados por 90 dias (o nome precisa começar com aws-waf-logs-)
resource "aws_cloudwatch_log_group" "waf" {
  provider          = aws.us_east_1
  name              = "aws-waf-logs-${local.nome}"
  retention_in_days = 90
}

resource "aws_wafv2_web_acl_logging_configuration" "borda" {
  provider                = aws.us_east_1
  resource_arn            = aws_wafv2_web_acl.borda.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    single_header { name = "x-csrf-token" }
  }
  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition { action = "BLOCK" }
      }
    }
  }
}
