# Opção econômica na AWS (Lightsail): um servidor com o site e a API, mais o banco gerenciado.
# PROPOSTA: nada aqui é executado sem autorização da Ameta. Passo a passo e custos: docs/fase-5-aws.md

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
  # O estado guarda a senha do banco: fica só no computador de quem cria (ou num bucket S3 privado).
}

provider "aws" {
  region = var.regiao
  default_tags {
    tags = { Projeto = "controle-nfse", Ambiente = "producao", Gerenciado = "terraform" }
  }
}
