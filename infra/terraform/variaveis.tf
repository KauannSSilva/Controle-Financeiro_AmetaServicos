variable "regiao" {
  description = "Região principal (São Paulo: dados ficam no Brasil)"
  type        = string
  default     = "sa-east-1"
}

variable "dominio" {
  description = "Endereço do site, ex.: controle.ametaservicos.com.br"
  type        = string
}

variable "zona_route53" {
  description = "Zona DNS no Route 53 que contém o domínio, ex.: ametaservicos.com.br (ou um subdomínio delegado)"
  type        = string
}

variable "email_alertas" {
  description = "E-mail que recebe os alarmes (precisa confirmar a inscrição)"
  type        = string
}

variable "versao_api" {
  description = "Tag da imagem da API no ECR (ex.: o hash do commit)"
  type        = string
}

variable "smtp_host" {
  description = "Servidor de e-mail dos convites (ex.: smtp.office365.com)"
  type        = string
}

variable "smtp_porta" {
  type    = number
  default = 587
}

variable "email_remetente" {
  type    = string
  default = "Controle Financeiro Ameta <nao-responda@ametaservicos.com.br>"
}

variable "banco_classe" {
  description = "Tamanho do banco. db.t4g.micro aguenta a equipe com folga."
  type        = string
  default     = "db.t4g.micro"
}

variable "banco_multi_az" {
  description = "Cópia do banco em outra zona (dobra o custo do banco; recomendado quando o site virar o único controle)"
  type        = bool
  default     = false
}

variable "api_tarefas" {
  description = "Quantas cópias da API ficam no ar"
  type        = number
  default     = 1
}
