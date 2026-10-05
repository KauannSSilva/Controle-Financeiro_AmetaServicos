-- Convite por e-mail: o usuário criado pelo ADMIN só entra depois de aceitar o convite
ALTER TABLE "usuarios"
  ADD COLUMN "convite_token_hash" VARCHAR(64),
  ADD COLUMN "convite_expira_em" TIMESTAMPTZ(3),
  ADD COLUMN "convite_aceito_em" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "usuarios_convite_token_hash_key" ON "usuarios"("convite_token_hash");

-- Quem já existia continua entrando normalmente
UPDATE "usuarios" SET "convite_aceito_em" = "criado_em";
