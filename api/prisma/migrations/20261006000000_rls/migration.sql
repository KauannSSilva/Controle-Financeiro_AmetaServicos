-- Fase 4: menor privilégio + Row Level Security.
-- A API conecta com o papel "ameta_app" (sem ser dono das tabelas nem superusuário). O perfil de quem
-- está logado chega em cada transação por SET LOCAL app.perfil / app.usuario_id, e as políticas abaixo
-- liberam leitura e escrita conforme esse perfil. As migrações continuam rodando com o dono do banco.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ameta_app') THEN
    CREATE ROLE ameta_app NOLOGIN;
  END IF;
END
$$;

-- Perfil e usuário da transação atual (vazio = nenhum: as políticas negam)
CREATE FUNCTION app_perfil() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.perfil', true), '') $$;
CREATE FUNCTION app_usuario_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid $$;

-- ---------- Permissões do papel da API ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ameta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ordens_compra", "itens_po", "historico_status", "usuarios", "sessoes", "codigos_recuperacao_mfa" TO ameta_app;
-- Auditoria só recebe registros novos: ninguém altera nem apaga
GRANT SELECT, INSERT ON "log_auditoria" TO ameta_app;
GRANT USAGE ON SEQUENCE "log_auditoria_id_seq" TO ameta_app;
GRANT SELECT ON "vw_itens_po" TO ameta_app;
GRANT EXECUTE ON FUNCTION app_perfil(), app_usuario_id() TO ameta_app;
-- A view passa a respeitar o RLS das tabelas (por padrão rodaria como o dono)
ALTER VIEW "vw_itens_po" SET (security_invoker = true);

-- ---------- RLS ligado e forçado (vale também para o dono das tabelas) ----------
ALTER TABLE "ordens_compra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordens_compra" FORCE ROW LEVEL SECURITY;
ALTER TABLE "itens_po" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itens_po" FORCE ROW LEVEL SECURITY;
ALTER TABLE "historico_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "historico_status" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usuarios" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessoes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "codigos_recuperacao_mfa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "codigos_recuperacao_mfa" FORCE ROW LEVEL SECURITY;
ALTER TABLE "log_auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "log_auditoria" FORCE ROW LEVEL SECURITY;

-- ---------- P.Os: todos leem; ADMIN e OPERADOR escrevem; só ADMIN apaga de vez ----------
CREATE POLICY ordens_ler ON "ordens_compra" FOR SELECT USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'VISUALIZADOR', 'SISTEMA'));
CREATE POLICY ordens_incluir ON "ordens_compra" FOR INSERT WITH CHECK (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA'));
CREATE POLICY ordens_alterar ON "ordens_compra" FOR UPDATE USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA')) WITH CHECK (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA'));
CREATE POLICY ordens_apagar ON "ordens_compra" FOR DELETE USING (app_perfil() IN ('ADMIN', 'SISTEMA'));

CREATE POLICY itens_ler ON "itens_po" FOR SELECT USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'VISUALIZADOR', 'SISTEMA'));
CREATE POLICY itens_incluir ON "itens_po" FOR INSERT WITH CHECK (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA'));
CREATE POLICY itens_alterar ON "itens_po" FOR UPDATE USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA')) WITH CHECK (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA'));
CREATE POLICY itens_apagar ON "itens_po" FOR DELETE USING (app_perfil() IN ('ADMIN', 'SISTEMA'));

CREATE POLICY historico_ler ON "historico_status" FOR SELECT USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'VISUALIZADOR', 'SISTEMA'));
CREATE POLICY historico_incluir ON "historico_status" FOR INSERT WITH CHECK (app_perfil() IN ('ADMIN', 'OPERADOR', 'SISTEMA'));
CREATE POLICY historico_apagar ON "historico_status" FOR DELETE USING (app_perfil() IN ('ADMIN', 'SISTEMA'));

-- ---------- Usuários: todos leem (nomes no histórico); ADMIN e o login escrevem; cada um altera a própria linha ----------
CREATE POLICY usuarios_ler ON "usuarios" FOR SELECT USING (app_perfil() IN ('ADMIN', 'OPERADOR', 'VISUALIZADOR', 'SISTEMA'));
CREATE POLICY usuarios_incluir ON "usuarios" FOR INSERT WITH CHECK (app_perfil() IN ('ADMIN', 'SISTEMA'));
CREATE POLICY usuarios_alterar ON "usuarios" FOR UPDATE
  USING (app_perfil() IN ('ADMIN', 'SISTEMA') OR "id" = app_usuario_id())
  WITH CHECK (app_perfil() IN ('ADMIN', 'SISTEMA') OR "id" = app_usuario_id());

-- ---------- Sessões e códigos de recuperação: só o login (SISTEMA) e o ADMIN ----------
CREATE POLICY sessoes_acesso ON "sessoes" FOR ALL USING (app_perfil() IN ('ADMIN', 'SISTEMA')) WITH CHECK (app_perfil() IN ('ADMIN', 'SISTEMA'));
CREATE POLICY codigos_acesso ON "codigos_recuperacao_mfa" FOR ALL USING (app_perfil() IN ('ADMIN', 'SISTEMA')) WITH CHECK (app_perfil() IN ('ADMIN', 'SISTEMA'));

-- ---------- Auditoria: qualquer perfil registra; só o ADMIN lê ----------
CREATE POLICY auditoria_incluir ON "log_auditoria" FOR INSERT WITH CHECK (app_perfil() IS NOT NULL);
CREATE POLICY auditoria_ler ON "log_auditoria" FOR SELECT USING (app_perfil() = 'ADMIN');
