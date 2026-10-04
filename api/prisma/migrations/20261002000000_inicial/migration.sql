-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "status_po" AS ENUM ('AGUARDANDO_LIBERACAO', 'EMITIR_NOTA', 'EM_EXECUCAO', 'EMITIDA', 'CANCELADO');

-- CreateEnum
CREATE TYPE "perfil_usuario" AS ENUM ('ADMIN', 'OPERADOR', 'VISUALIZADOR');

-- CreateTable
CREATE TABLE "ordens_compra" (
    "id" UUID NOT NULL,
    "numero_po" VARCHAR(20) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_por" UUID,
    "atualizado_por" UUID,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "ordens_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_po" (
    "id" UUID NOT NULL,
    "ordem_compra_id" UUID NOT NULL,
    "item" VARCHAR(20),
    "id_site" VARCHAR(50),
    "site" VARCHAR(100),
    "fase" VARCHAR(20),
    "tecnologia" VARCHAR(5),
    "projeto" VARCHAR(150),
    "uf" CHAR(2),
    "operadora" VARCHAR(10),
    "valor_original" DECIMAL(12,2),
    "percentual_multa" DECIMAL(5,2),
    "possui_multa" BOOLEAN NOT NULL DEFAULT false,
    "status" "status_po" NOT NULL,
    "status_origem" VARCHAR(60),
    "numero_nfse" VARCHAR(30),
    "data_emissao" DATE,
    "numero_migo" VARCHAR(30),
    "observacoes" TEXT,
    "linha_planilha" INTEGER,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_por" UUID,
    "atualizado_por" UUID,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "itens_po_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_status" (
    "id" UUID NOT NULL,
    "item_po_id" UUID NOT NULL,
    "status_de" "status_po",
    "status_para" "status_po" NOT NULL,
    "possui_multa" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" UUID,
    "motivo" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nome_cifrado" BYTEA NOT NULL,
    "email_cifrado" BYTEA NOT NULL,
    "email_hash" VARCHAR(128) NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "perfil" "perfil_usuario" NOT NULL,
    "mfa_secret_cifrado" BYTEA,
    "mfa_ativo" BOOLEAN NOT NULL DEFAULT false,
    "mfa_ultimo_passo" BIGINT,
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ(3),
    "aceite_termos_versao" VARCHAR(20),
    "aceite_termos_em" TIMESTAMPTZ(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_recuperacao_mfa" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_recuperacao_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogado_em" TIMESTAMPTZ(3),
    "ultimo_uso_em" TIMESTAMPTZ(3),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "acao" VARCHAR(60) NOT NULL,
    "entidade" VARCHAR(60),
    "entidade_id" VARCHAR(60),
    "ip" VARCHAR(45),
    "valores_antes" JSONB,
    "valores_depois" JSONB,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordens_compra_numero_po_key" ON "ordens_compra"("numero_po");

-- CreateIndex
CREATE UNIQUE INDEX "itens_po_linha_planilha_key" ON "itens_po"("linha_planilha");

-- CreateIndex
CREATE INDEX "itens_po_status_idx" ON "itens_po"("status");

-- CreateIndex
CREATE INDEX "itens_po_data_emissao_idx" ON "itens_po"("data_emissao");

-- CreateIndex
CREATE INDEX "itens_po_numero_nfse_idx" ON "itens_po"("numero_nfse");

-- CreateIndex
CREATE INDEX "itens_po_ordem_compra_id_idx" ON "itens_po"("ordem_compra_id");

-- CreateIndex
CREATE INDEX "itens_po_operadora_idx" ON "itens_po"("operadora");

-- CreateIndex
CREATE INDEX "historico_status_item_po_id_criado_em_idx" ON "historico_status"("item_po_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_hash_key" ON "usuarios"("email_hash");

-- CreateIndex
CREATE INDEX "codigos_recuperacao_mfa_usuario_id_idx" ON "codigos_recuperacao_mfa"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_refresh_token_hash_key" ON "sessoes"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessoes_usuario_id_idx" ON "sessoes"("usuario_id");

-- CreateIndex
CREATE INDEX "log_auditoria_entidade_entidade_id_idx" ON "log_auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "log_auditoria_criado_em_idx" ON "log_auditoria"("criado_em");

-- AddForeignKey
ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_ordem_compra_id_fkey" FOREIGN KEY ("ordem_compra_id") REFERENCES "ordens_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_status" ADD CONSTRAINT "historico_status_item_po_id_fkey" FOREIGN KEY ("item_po_id") REFERENCES "itens_po"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_status" ADD CONSTRAINT "historico_status_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_recuperacao_mfa" ADD CONSTRAINT "codigos_recuperacao_mfa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

