# Fase 4 — Relatório de segurança

Referências: **OWASP Top 10 (2021)** e **OWASP ASVS 4.0.3, nível 2**.
Para cada item: como o sistema atende e como conferir. Os comandos rodam na pasta do projeto.

## Verificações automáticas

| Comando | O que confere |
|---|---|
| `npm test` | 135 testes da API, incluindo RLS, permissões por perfil, login/MFA, convite, termos, senhas vazadas e inventário de rotas |
| `npm run security:scan` | `.env` fora do Git (e do histórico), gitleaks no histórico inteiro, `npm audit` (moderado ou pior falha) e build do site sem nenhum valor do `.env` dentro |
| `npm run api:rotas` | Regera `docs/inventario-rotas.md`; um teste falha se o arquivo não bater com as rotas reais |
| CI do GitHub (`.github/workflows/ci.yml`) | Tipos, testes com PostgreSQL, build, `npm audit` e gitleaks em todo push e PR |
| Dependabot (`.github/dependabot.yml`) | PRs semanais de atualização (npm, GitHub Actions e imagens Docker) |

## Requisitos da seção 7 da especificação

| Requisito | Situação | Onde |
|---|---|---|
| RLS com ENABLE + FORCE, usuário da aplicação que não é dono, perfil por `SET LOCAL`, migrações com outro usuário | Feito | `api/prisma/migrations/20261006000000_rls`, `api/src/db.ts`, `api/scripts/configurar-banco.ts`, `api/test/rls.test.ts` |
| Política de senha forte + bloqueio de senhas vazadas | Feito | `api/src/seguranca/senha.ts` (12–128 caracteres, lista NCSC de 100 mil senhas vazadas, variações com números, nome da empresa e e-mail) |
| Termos de Uso e Política de Privacidade versionados, aceite obrigatório no 1º acesso e a cada nova versão, guardando versão e data | Feito (texto é rascunho para revisão jurídica) | `api/src/termos/termos.ts`, `web/src/paginas/Termos.tsx` |
| Varredura de segredos (gitleaks), caça a `.env`, front sem segredos | Feito | `scripts/varredura-seguranca.mjs` |
| APIs alternativas: inventário de rotas, sem TRACE e sem troca de método | Feito | `docs/inventario-rotas.md`, `api/test/permissoes.test.ts` |
| `npm audit`, Dependabot, versões fixas | Feito (0 vulnerabilidades) | `package.json` (`overrides`), `package-lock.json` |
| `docker compose up` sobe banco, API e front | Feito | `docker-compose.yml`, `api/Dockerfile`, `web/Dockerfile`, `web/nginx.conf` |

## OWASP Top 10 (2021)

### A01 — Controle de acesso quebrado
- **Como:** toda rota declara quem pode acessar (`config.acesso`); rota sem declaração impede a API de subir (negar por padrão). Perfis ADMIN, OPERADOR e VISUALIZADOR checados na API. No banco, RLS com `FORCE` em todas as tabelas: a API conecta como `ameta_app` (não é dono, não é superusuário, sem `BYPASSRLS`) e cada consulta recebe o perfil por `SET LOCAL`; sem perfil, nada é lido nem gravado. Log de auditoria só aceita inserir (nem o ADMIN altera ou apaga). CSRF por token duplo (cookie + cabeçalho) e cookies `SameSite=Strict`.
- **Testar:** `npm test` (arquivos `permissoes.test.ts` e `rls.test.ts`). Na tela, entre como Visualizador: não aparecem botões de alterar, e a chamada direta à API devolve 403.

### A02 — Falhas criptográficas
- **Como:** senhas com Argon2id (19 MiB, 2 iterações). Nome, e-mail e segredo MFA cifrados no banco com AES-256-GCM; e-mail buscado por HMAC. Tokens de sessão, convite e códigos de recuperação guardados só como hash. Chaves geradas aleatoriamente (`npm run api:chaves`) e mantidas só no `.env`. Cookies `HttpOnly` e `Secure`; HSTS ligado.
- **Testar:** `npm run db:studio` e abra a tabela `usuarios`: nome, e-mail e senha aparecem cifrados/hasheados.
- **Fase 5:** HTTPS (TLS 1.2+) no balanceador da AWS e chaves no AWS Secrets Manager.

### A03 — Injeção
- **Como:** acesso ao banco só pelo Prisma (consultas parametrizadas); o único SQL manual usa `Prisma.sql` com parâmetros. Toda entrada validada por esquemas Zod (tipos, tamanhos, listas fixas). React escapa o conteúdo das telas; o e-mail do convite escapa o HTML. CSP sem `unsafe-eval` nem scripts de terceiros.
- **Testar:** `npm test` (casos de dados inválidos devolvem 400 com o campo). Tente cadastrar um nome com `<script>`: aparece como texto.

### A04 — Design inseguro
- **Como:** regras de negócio na API, não só na tela (ex.: Emitida exige número e data da NFS-e; ao sair de Emitida a NFS-e é apagada e registrada no histórico). Limites de taxa e bloqueio progressivo de login. Convite de uso único, válido 72 h. Exclusão definitiva só para ADMIN e sempre auditada.
- **Testar:** `npm test` (`ordens.test.ts`, `ordens-api.test.ts`, `convite.test.ts`).

### A05 — Configuração incorreta de segurança
- **Como:** cabeçalhos de segurança na API (helmet) e no nginx: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Erros sem stack trace (só mensagem e código de correlação). Swagger desligado em produção. nginx sem versão no cabeçalho, nega arquivos ocultos (`.env`, `.git`) e métodos fora da lista (TRACE = 405). Contêineres sem root, sistema de arquivos só leitura, sem capacidades extras. Banco e Mailpit só escutam no próprio computador.
- **Testar:** com `docker compose up`, rode `curl -I http://localhost:8080/` (cabeçalhos), `curl -i http://localhost:8080/.env` (404) e `curl -i -X TRACE http://localhost:8080/` (405).

### A06 — Componentes vulneráveis e desatualizados
- **Como:** `package-lock.json` com versões fixas, instalação com `npm ci`, `overrides` para corrigir dependências indiretas, `npm audit` no CI e na varredura, Dependabot semanal. Imagens Docker com versão fixa.
- **Testar:** `npm audit` (0 vulnerabilidades em 06/10/2026).

### A07 — Falhas de identificação e autenticação
- **Como:** senha + MFA obrigatório (TOTP, com bloqueio de reuso do código) para todos os perfis; 10 códigos de recuperação de uso único. Senha de 12 a 128 caracteres, sem senhas vazadas ou óbvias. 5 erros em 15 min bloqueiam a conta, dobrando o tempo a cada novo bloqueio. Mensagem de erro igual para e-mail inexistente e senha errada. Token de acesso de 15 min, refresh rotativo, sessão expira com 30 min sem uso e no máximo em 12 h; troca de senha encerra as outras sessões. Senha provisória precisa ser trocada no primeiro acesso. Ações sensíveis do ADMIN (criar, editar, bloquear, destravar ou excluir usuário, resetar MFA, senha provisória, reenviar convite, restaurar e excluir P.O de vez) pedem a senha e o código do app de novo; a confirmação vale 5 minutos e só na sessão onde foi feita. Trocar a própria senha também pede o código (menos na senha provisória).
- **Testar:** `npm test` (`auth.test.ts`). Na tela: tente trocar a senha para `flamengo123456` (recusada: senha vazada).

### A08 — Falhas de integridade de software e dados
- **Como:** dependências travadas pelo lockfile com hash de integridade; o npm do projeto só roda scripts de instalação aprovados. CI com permissões só de leitura. Histórico de status de cada P.O e log de auditoria que não pode ser alterado.
- **Testar:** `npm test` (`rls.test.ts`: UPDATE/DELETE/TRUNCATE na auditoria são negados até para ADMIN).

### A09 — Falhas de log e monitoramento
- **Como:** auditoria de login (sucesso, falha, bloqueio), MFA, convites, termos, usuários e todas as alterações em P.Os, com quem, quando e o antes/depois. Tela de Auditoria em frases simples. Logs da API sem cookies, tokens nem CSRF; cada erro interno tem um código de correlação.
- **Testar:** faça um login errado e veja na tela Auditoria.
- **Fase 5:** logs centralizados e alertas (CloudWatch).

### A10 — SSRF
- **Como:** a API não busca URLs informadas pelo usuário. As únicas conexões de saída são o banco e o servidor de e-mail, ambos fixos no `.env`.
- **Testar:** `docs/inventario-rotas.md` mostra que nenhuma rota recebe URL.

## ASVS 4.0.3 — nível 2, por capítulo

| Capítulo | Como é atendido | Como testar |
|---|---|---|
| V1 Arquitetura | Camadas separadas (site → nginx → API → banco); controle de acesso no servidor e no banco (RLS); inventário de rotas versionado | `docs/inventario-rotas.md`, `rls.test.ts` |
| V2 Autenticação | Senha 12–128, bloqueio de vazadas, Argon2id, MFA obrigatório, nova confirmação de senha + código antes de ações sensíveis, limite de tentativas, recuperação por códigos de uso único, convite de uso único com validade | `auth.test.ts`, `convite.test.ts`, `confirmacao.test.ts` |
| V3 Sessão | Cookies `HttpOnly`, `Secure`, `SameSite=Strict`; tokens aleatórios guardados como hash; expiração por inatividade e absoluta; refresh rotativo; logout e troca de senha revogam sessões | `auth.test.ts` |
| V4 Controle de acesso | Negar por padrão; perfil checado em toda rota; RLS forçado; ADMIN não altera auditoria | `permissoes.test.ts`, `rls.test.ts` |
| V5 Validação e codificação | Zod em todas as entradas; consultas parametrizadas; saída escapada; limite de 100 KB por requisição | `ordens-api.test.ts` |
| V6 Criptografia | AES-256-GCM, HMAC-SHA-256, Argon2id, aleatoriedade do sistema (`crypto.randomBytes`); chaves fora do código | `npm run security:scan` |
| V7 Erros e logs | Sem stack trace para o usuário; correlação; dados sensíveis fora dos logs; auditoria imutável | `rls.test.ts`, tela Auditoria |
| V8 Proteção de dados | Dados pessoais cifrados; `Cache-Control: no-store` na API; Política de Privacidade (LGPD) com aceite registrado | `termos.test.ts` |
| V9 Comunicação | HSTS e cookies `Secure` já ligados; TLS chega na Fase 5 (AWS) | — |
| V10 Código malicioso | Sem segredos no repositório (gitleaks), dependências auditadas, scripts de instalação controlados | `npm run security:scan` |
| V11 Lógica de negócio | Regras de status na API, limites de taxa, bloqueio de login | `ordens.test.ts` |
| V12 Arquivos | A API não recebe upload; a planilha é importada só por script local, fora da web | — |
| V13 API | Só GET/POST/PATCH/DELETE; TRACE e troca de método (`X-HTTP-Method-Override`) bloqueados; JSON obrigatório; CORS só para o site | `permissoes.test.ts` |
| V14 Configuração | Versões fixas, Dependabot, contêineres sem root e só leitura, Swagger fora de produção, cabeçalhos de segurança | `docker compose up` + `curl -I` |

## Pendências para a Fase 5 (AWS)

1. HTTPS com certificado no balanceador e `trustProxy` só para ele.
2. Chaves e senhas no AWS Secrets Manager (não em arquivo).
3. Servidor de e-mail real da empresa para os convites.
4. Backups automáticos do banco e teste de restauração.
5. Logs centralizados e alertas de login suspeito.
6. Revisão jurídica do texto dos Termos de Uso e da Política de Privacidade (versão 1.0 é rascunho).
7. Teste de invasão (pentest) antes de abrir o sistema para a equipe.
