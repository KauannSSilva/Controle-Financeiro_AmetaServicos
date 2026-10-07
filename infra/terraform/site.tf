# Site (React) num bucket S3 privado, servido pelo CloudFront com HTTPS e o WAF.
# O CloudFront também repassa /api/* para o balanceador: site e API no mesmo endereço (cookies SameSite=Strict).

data "aws_route53_zone" "principal" {
  name = var.zona_route53
}

resource "aws_s3_bucket" "site" {
  bucket = "${local.nome}-site-${data.aws_caller_identity.atual.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.nome}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}

# Certificado do endereço do site (precisa estar em us-east-1)
resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = var.dominio
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validacao_site" {
  for_each = { for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o }
  zone_id  = data.aws_route53_zone.principal.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validacao_site : r.fqdn]
}

# Endereços do site (/usuarios, /auditoria...) devolvem o index.html; arquivos (/assets/x.js) vão direto
resource "aws_cloudfront_function" "spa" {
  name    = "${local.nome}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      if (req.uri.indexOf('.') === -1) req.uri = '/index.html';
      return req;
    }
  JS
}

# Mesmos cabeçalhos de segurança do ambiente local (web/cabecalhos.inc)
resource "aws_cloudfront_response_headers_policy" "site" {
  name = "${local.nome}-seguranca"
  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
      override                = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
  remove_headers_config {
    items { header = "Server" }
  }
}

data "aws_cloudfront_cache_policy" "otimizado" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "sem_cache" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "tudo_menos_host" { name = "Managed-AllViewerExceptHostHeader" }

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  aliases             = [var.dominio]
  default_root_object = "index.html"
  http_version        = "http2and3"
  price_class         = "PriceClass_All" # inclui os pontos de presença no Brasil
  web_acl_id          = aws_wafv2_web_acl.borda.arn
  comment             = "Controle de NFS-e Ameta"

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = "api"
    domain_name = local.dominio_origem
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "X-Origem-Ameta"
      value = random_password.cabecalho_origem.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.otimizado.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  # A API nunca fica em cache; os cabeçalhos de segurança vêm da própria API
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.sem_cache.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.tudo_menos_host.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "site" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.principal.zone_id
  name     = var.dominio
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
