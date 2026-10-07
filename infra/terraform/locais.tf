data "aws_caller_identity" "atual" {}
data "aws_availability_zones" "disponiveis" { state = "available" }

locals {
  nome  = "ameta-nfse"
  tags  = { Projeto = "controle-nfse", Empresa = "Ameta Servicos", GerenciadoPor = "terraform" }
  zonas = slice(data.aws_availability_zones.disponiveis.names, 0, 2)
  # O ALB só responde ao CloudFront: o endereço de origem tem um certificado próprio
  dominio_origem = "origem-api.${var.dominio}"
}
