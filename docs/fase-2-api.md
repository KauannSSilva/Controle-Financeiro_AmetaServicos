# Fase 2 — API, login com MFA e perfis

API REST em `/api/v1` que o site (Fase 3) vai usar. Login com senha e código do autenticador para todos, três perfis (ADMIN, OPERADOR, VISUALIZADOR) conferidos no servidor em toda rota, e auditoria de login, alterações de P.O e ações de ADMIN.

## Como funciona o login

1. **E-mail e senha** (`POST auth/login`). Erro de senha ou e-mail inexistente dão a mesma mensagem: "E-mail ou senha inválidos".
2. **Primeiro acesso:** a API gera o QR Code (`POST auth/mfa/configurar` ou a imagem em `GET auth/mfa/qrcode.png`), você escaneia no Google Authenticator ou Microsoft Authenticator e confirma com o código de 6 dígitos (`POST auth/mfa/ativar`). Nessa hora aparecem **10 códigos de recuperação**, uma única vez, para usar se perder o celular.
3. **Nos acessos seguintes:** o código de 6 dígitos do app (`POST auth/mfa/verificar`), ou um código de recuperação.
4. Usuário criado pelo ADMIN recebe uma senha provisória e precisa trocá-la (`POST auth/trocar-senha`) antes de usar o sistema.

Não existe cadastro público. O primeiro ADMIN é criado pelo comando `npm run seed:admin`; os outros usuários, pelo ADMIN.

## Regras de segurança desta fase

| Regra | Como ficou |
|---|---|
| Negar por padrão | Toda rota declara quem pode usá-la; a API não sobe se uma rota não declarar. Sem login, tudo responde 401, menos login e health check. Há um teste que percorre todas as rotas. |
| Perfis | Conferidos no servidor em toda requisição, lendo o perfil atual do banco: mudar o perfil de alguém vale na hora. |
| Senhas | Argon2id. Mínimo de 12 caracteres; senhas comuns, sequências e senhas com o próprio e-mail são recusadas. |
| MFA | TOTP de 6 dígitos e 30 s (RFC 6238), tolerância de ±1 janela, o mesmo código não vale duas vezes. Segredo gravado cifrado. Códigos de recuperação com hash e uso único. |
| Tentativas erradas | 5 erros seguidos (senha ou código) bloqueiam o usuário por 15 min; cada novo bloqueio dobra o tempo, até 24 h. 10 erros do mesmo IP em 15 min bloqueiam o IP. Limite extra de 20 tentativas por minuto nas rotas de login e 300 requisições por minuto no geral. |
| Dados pessoais | Nome, e-mail e segredo MFA cifrados com AES-256-GCM; e-mail também como HMAC para a busca. Chaves no `.env` (na AWS, no Secrets Manager). |
| Sessão | Token de acesso de 15 min (JWT só HS256, `alg: none` recusado) e refresh token trocado a cada renovação. Cookies HttpOnly, Secure e SameSite=Strict. Sessão cai após 30 min sem uso ou 12 h no total. Sair, bloquear o usuário, resetar o MFA ou trocar a senha derrubam as sessões no servidor. |
| CSRF | Toda alteração exige o cabeçalho `x-csrf-token` igual ao cookie `ameta_csrf`. |
| Entrada de dados | Todo campo validado (tipo, tamanho, formato); campos desconhecidos na edição são recusados. Só consultas parametrizadas (Prisma). Testes com textos de injeção SQL. |
| Erros | Mensagem genérica e um código de correlação; nada de stack trace. |
| Cabeçalhos | CSP restritiva, X-Frame-Options DENY, HSTS com includeSubDomains, nosniff, Referrer-Policy. CORS só para o endereço do front. |
| Rotas | Uma API só, em `/api/v1`. `TRACE` e troca de método por cabeçalho são recusados. `/.env`, `/.git/config` e afins dão 404. A página de documentação (`/api/v1/docs`) não existe em produção. |
| Auditoria | Login (ok e falhas), MFA ativado, códigos de recuperação usados, saída, troca de senha, bloqueios, criação/edição/exclusão de usuários, reset de MFA e toda alteração de P.O, com IP. Nome, e-mail e senha não entram no log. |

Ficam para a **Fase 4** (hardening): usuário de banco sem privilégio e Row Level Security, lista grande de senhas vazadas, varredura de segredos (gitleaks), Termos de Uso com aceite, inventário de rotas comparado em teste de CI, HTTPS real e o relatório OWASP.

## Permissões (seção 5.2)

| Ação | Rota | ADMIN | OPERADOR | VISUALIZADOR |
|---|---|---|---|---|
| Tela inicial, contadores, listas e detalhe da P.O | `GET inicio`, `contadores`, `itens`, `ordens/{numeroPo}` | Sim | Sim | Sim |
| Adicionar / editar | `POST itens`, `PATCH itens/{id}` | Sim | Sim | Não |
| Mover de status | `POST itens/{id}/mover` | Sim | Sim | Não |
| Remover (some das listas) | `DELETE itens/{id}`, `DELETE ordens/{numeroPo}` | Sim | Sim | Não |
| Ver removidos, restaurar, excluir de vez | `GET itens/removidos`, `POST itens/{id}/restaurar`, `DELETE itens/{id}/definitivo` | Sim | Não | Não |
| Usuários: ver, criar, editar, bloquear, excluir | `usuarios` | Sim | Não | Não |
| Alterar perfil, resetar MFA, senha provisória, desbloquear | `usuarios/{id}/...` | Sim | Não | Não |
| Ver auditoria | `GET auditoria` | Sim | Não | Não |

O único ADMIN ativo não consegue tirar o próprio perfil de ADMIN, se bloquear nem se excluir.

## Mover uma P.O de status

`POST itens/{id}/mover` com `para` (o novo status) e, opcionalmente, `motivo`.

- **Para Emitida** é obrigatório ter o **número da NFS-e** e a **data de emissão**: informe no próprio pedido (`numeroNfse`, `dataEmissao`) se o item ainda não tiver. Data no futuro é recusada.
- **Saindo de Emitida** para qualquer status menos Cancelado, o número da NFS-e e a data de emissão são apagados (pedido da Ameta em 05/10/2026). O número antigo fica no motivo do histórico e na auditoria. Para Cancelado, a nota continua no item.
- **Com multa:** `possuiMulta: true` e `percentualMulta` entre 0 e 100 (88 = recebe 88%).
- **Ninguém mudou antes de você:** o site manda a `versao` (o `atualizadoEm` de quando a tela abriu). Se outra pessoa alterou a P.O nesse meio tempo, a API recusa com 409 e pede para recarregar. Duas mudanças no mesmo instante também não se atropelam (a linha fica travada durante a gravação).
- Depois de gravar: a P.O muda de aba, contadores e tela inicial já refletem, o status financeiro segue a regra da planilha (Emitida = FECHADO, Emitir Nota = ENTREGUE, resto = NOVO) e o histórico guarda quem, quando, de qual para qual status e o motivo. Errou? Mova de volta; as duas mudanças ficam no histórico.

As notas emitidas que vieram da planilha sem número ou sem data continuam como estão; a regra vale para as próximas mudanças. Editar uma nota emitida não deixa apagar o número nem a data.

## Rodar e testar no seu computador

Os passos para Windows (PowerShell) estão no [README](../README.md#api-fase-2). Depois de subir a API, abra `http://localhost:3000/api/v1/docs`: é uma página que lista todas as rotas e deixa testar cada uma com **Try it out** e **Execute**.

## Escolha técnica

A especificação sugere "NestJS (ou Fastify)". Usei **Fastify**: o NestJS depende de metadados de decorators que as ferramentas já usadas na Fase 1 (tsx e Vitest) não geram, o que obrigaria a um passo de compilação a mais só para rodar e testar. O Fastify roda com o que já está instalado, é mais leve e tem os plugins de segurança oficiais (helmet, rate limit, cookies, CORS). Validação com Zod, como a especificação pede.

## Testes

`npm test` roda 106 testes num banco separado (`ameta_teste`): os 40 da Fase 1 (alguns ajustados à regra nova da nota emitida) e os novos de login, MFA, sessão, permissões de cada perfil, rotas sem login, validação, injeção SQL e o fluxo de mover uma P.O para Emitida.
