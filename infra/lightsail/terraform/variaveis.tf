variable "regiao" {
  description = "Região (São Paulo: dados ficam no Brasil)"
  type        = string
  default     = "sa-east-1"
}

variable "zona" {
  description = "Zona de disponibilidade do servidor e do banco"
  type        = string
  default     = "sa-east-1a"
}

variable "plano_servidor" {
  description = "Plano do servidor (small_3_0 = 2 GB de memória, 2 vCPUs, 60 GB de disco)"
  type        = string
  default     = "small_3_0"
}

variable "plano_banco" {
  description = "Plano do banco (micro_2_0 = 1 GB, 40 GB de disco; micro_ha_2_0 = cópia em outra zona, o dobro do preço)"
  type        = string
  default     = "micro_2_0"
}


variable "ip_ssh" {
  description = "IPs extras (CIDR) que podem entrar por SSH. Vazio = só o terminal do próprio console do Lightsail."
  type        = list(string)
  default     = []
}
