# Inventário de rotas da API

Gerado por `npm run api:rotas`. Um teste automático compara este arquivo com as rotas que a API realmente expõe:
rota nova, removida ou com acesso diferente faz o teste falhar até o inventário ser atualizado e revisado.

Fora destas, só existem as páginas do Swagger (`/api/v1/docs`), que não sobem em produção.

Total: 35 rotas, todas em `/api/v1`.

| Método | Rota | Quem acessa |
|---|---|---|
| GET | `/api/v1/auditoria` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/auth/convite/aceitar` | Pública (sem login) |
| GET | `/api/v1/auth/eu` | Logado com MFA |
| POST | `/api/v1/auth/login` | Pública (sem login) |
| POST | `/api/v1/auth/mfa/ativar` | Depois da senha, antes do código MFA |
| POST | `/api/v1/auth/mfa/configurar` | Depois da senha, antes do código MFA |
| GET | `/api/v1/auth/mfa/qrcode.png` | Depois da senha, antes do código MFA |
| POST | `/api/v1/auth/mfa/verificar` | Depois da senha, antes do código MFA |
| POST | `/api/v1/auth/renovar` | Renovação da sessão (cookie de refresh) |
| POST | `/api/v1/auth/sair` | Logado com MFA |
| GET | `/api/v1/auth/termos` | Pública (sem login) |
| POST | `/api/v1/auth/termos/aceitar` | Logado com MFA |
| POST | `/api/v1/auth/trocar-senha` | Logado com MFA |
| GET | `/api/v1/contadores` | Logado com MFA, perfil ADMIN, OPERADOR, VISUALIZADOR |
| GET | `/api/v1/inicio` | Logado com MFA, perfil ADMIN, OPERADOR, VISUALIZADOR |
| GET | `/api/v1/itens` | Logado com MFA, perfil ADMIN, OPERADOR, VISUALIZADOR |
| POST | `/api/v1/itens` | Logado com MFA, perfil ADMIN, OPERADOR |
| DELETE | `/api/v1/itens/:id` | Logado com MFA, perfil ADMIN, OPERADOR |
| PATCH | `/api/v1/itens/:id` | Logado com MFA, perfil ADMIN, OPERADOR |
| DELETE | `/api/v1/itens/:id/definitivo` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/itens/:id/mover` | Logado com MFA, perfil ADMIN, OPERADOR |
| POST | `/api/v1/itens/:id/restaurar` | Logado com MFA, perfil ADMIN |
| GET | `/api/v1/itens/removidos` | Logado com MFA, perfil ADMIN |
| DELETE | `/api/v1/ordens/:numeroPo` | Logado com MFA, perfil ADMIN, OPERADOR |
| GET | `/api/v1/ordens/:numeroPo` | Logado com MFA, perfil ADMIN, OPERADOR, VISUALIZADOR |
| GET | `/api/v1/saude` | Pública (sem login) |
| GET | `/api/v1/usuarios` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/usuarios` | Logado com MFA, perfil ADMIN |
| DELETE | `/api/v1/usuarios/:id` | Logado com MFA, perfil ADMIN |
| GET | `/api/v1/usuarios/:id` | Logado com MFA, perfil ADMIN |
| PATCH | `/api/v1/usuarios/:id` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/usuarios/:id/desbloquear` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/usuarios/:id/reenviar-convite` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/usuarios/:id/resetar-mfa` | Logado com MFA, perfil ADMIN |
| POST | `/api/v1/usuarios/:id/senha-provisoria` | Logado com MFA, perfil ADMIN |
