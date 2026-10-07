-- Termos de Uso e Política de Privacidade: versão e data do último aceite (todos aceitam no próximo acesso)
ALTER TABLE "usuarios"
  ADD COLUMN "termos_versao_aceita" VARCHAR(20),
  ADD COLUMN "termos_aceitos_em" TIMESTAMPTZ(3);
