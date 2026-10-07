# Rede: 2 zonas. Subredes públicas para o balanceador e a API (sem NAT: economiza ~US$ 40/mês;
# a API não aceita nenhuma conexão de fora, só do balanceador). Subredes privadas, sem saída, para o banco.

resource "aws_vpc" "principal" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.nome }
}

resource "aws_internet_gateway" "principal" {
  vpc_id = aws_vpc.principal.id
}

resource "aws_subnet" "publica" {
  count             = 2
  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index)
  availability_zone = local.zonas[count.index]
  tags              = { Name = "${local.nome}-publica-${count.index}" }
}

resource "aws_subnet" "privada" {
  count             = 2
  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index + 10)
  availability_zone = local.zonas[count.index]
  tags              = { Name = "${local.nome}-privada-${count.index}" }
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principal.id
  }
}

resource "aws_route_table_association" "publica" {
  count          = 2
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

# Subredes privadas usam a tabela padrão da VPC, que não tem rota para a internet

# Grupos de segurança: cada camada só fala com a seguinte
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.nome}-alb"
  description = "HTTPS so a partir do CloudFront"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_cloudfront" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_security_group" "api" {
  name        = "${local.nome}-api"
  description = "API: entra so do ALB"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_vpc_security_group_ingress_rule" "api_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

# Saída da API: HTTPS (ECR, Secrets Manager, CloudWatch), e-mail e o banco
resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "api_smtp" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = var.smtp_porta
  to_port           = var.smtp_porta
}

resource "aws_vpc_security_group_egress_rule" "api_banco" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.banco.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "banco" {
  name        = "${local.nome}-banco"
  description = "PostgreSQL: so a API e a tarefa de migracao"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_vpc_security_group_ingress_rule" "banco_api" {
  security_group_id            = aws_security_group.banco.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
