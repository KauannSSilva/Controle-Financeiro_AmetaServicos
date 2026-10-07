output "ip_do_servidor" {
  description = "Crie um registro DNS tipo A do domínio do site apontando para este IP"
  value       = aws_lightsail_static_ip.servidor.ip_address
}

output "banco_endereco" {
  value = aws_lightsail_database.principal.master_endpoint_address
}

output "banco_senha_dono" {
  description = "terraform output -raw banco_senha_dono (vai só para o arquivo .env do servidor)"
  value       = random_password.banco_dono.result
  sensitive   = true
}
