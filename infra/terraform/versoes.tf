# Infraestrutura da AWS (Fase 5). PROPOSTA: nada aqui é executado sem autorização da Ameta.
# Passo a passo e custos: docs/fase-5-aws.md

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }

  # O estado guarda senhas geradas aqui: fica num bucket S3 privado e criptografado (criado à mão, uma vez).
  # backend "s3" {
  #   bucket       = "ameta-terraform-estado"
  #   key          = "controle-nfse/terraform.tfstate"
  #   region       = "sa-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.regiao
  default_tags { tags = local.tags }
}

# Certificado do CloudFront e WAF de borda precisam ficar em us-east-1 (regra da AWS)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = local.tags }
}
