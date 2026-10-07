output "endereco_site" {
  value = "https://${var.dominio}"
}

output "bucket_site" {
  description = "Onde publicar o build do site (aws s3 sync web/dist s3://...)"
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_id" {
  description = "Para limpar o cache depois de publicar o site"
  value       = aws_cloudfront_distribution.site.id
}

output "repositorios_ecr" {
  value = { for k, r in aws_ecr_repository.api : k => r.repository_url }
}

locals {
  rodar_tarefa = join(" ", [
    "aws ecs run-task --cluster ${aws_ecs_cluster.principal.name} --launch-type FARGATE",
    "--task-definition ${aws_ecs_task_definition.tarefas.family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.publica[*].id)}],securityGroups=[${aws_security_group.api.id}],assignPublicIp=ENABLED}'",
  ])
}

output "comando_migracao" {
  description = "Roda as migrações antes de atualizar a API"
  value       = local.rodar_tarefa
}

output "comando_tarefa_base" {
  description = "Base para as outras tarefas (primeiro ADMIN, importação): acrescente --overrides, veja docs/fase-5-aws.md"
  value       = local.rodar_tarefa
}

output "servico_api" {
  value = { cluster = aws_ecs_cluster.principal.name, servico = aws_ecs_service.api.name }
}
