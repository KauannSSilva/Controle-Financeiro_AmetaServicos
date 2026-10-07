-- Ações sensíveis do ADMIN pedem a senha e o código MFA de novo; a confirmação vale por alguns minutos na sessão
ALTER TABLE "sessoes" ADD COLUMN "identidade_confirmada_em" TIMESTAMPTZ(3);
