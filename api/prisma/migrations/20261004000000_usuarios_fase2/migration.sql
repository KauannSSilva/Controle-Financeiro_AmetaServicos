-- Fase 2: troca de senha obrigatória no primeiro acesso e exclusão de usuário sem perder o histórico.
ALTER TABLE "usuarios" ADD COLUMN "deve_trocar_senha" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "usuarios" ADD COLUMN "excluido_em" TIMESTAMPTZ(3);
