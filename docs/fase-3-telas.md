# Fase 3 — Telas do site

Site em `web/` (React, TypeScript, Vite e Tailwind) que usa a API da Fase 2. Para rodar no seu computador, veja o [README](../README.md#site-fase-3).

## Telas

| Tela | O que tem |
|---|---|
| Login | E-mail e senha, depois o código do app. No primeiro acesso: QR Code (ou a chave para digitar), confirmação e os 10 códigos de recuperação, com botões Copiar e Imprimir. Quem recebeu senha provisória cria a própria senha antes de entrar. |
| Menu lateral | Logo da Ameta, Início, Aguardando Liberação, Emitir Nota, Em Execução, Emitidas, Canceladas, com a quantidade de itens em cada um. Só para ADMIN: Usuários, Auditoria e Removidos. No celular, o menu abre pelo botão ☰. |
| Topo | Nome, perfil, Trocar senha e Sair. |
| Início | Quantidade por status, o card "P.Os a emitir" com o total e as 10 últimas em Emitir Nota, e as 10 últimas emitidas (pela data de emissão), indicando multa. Links "Ver todas". |
| Abas de status | Tabela com busca (P.O, NFS-e, ID do site, site ou projeto), filtros (cliente, UF, valor mínimo e máximo; nas Emitidas e Canceladas, também o período de emissão), ordenação clicando no título da coluna e páginas de 50. Emitidas tem as abas Todas, Sem multa e Com multa. |
| Detalhe da P.O | Clique em uma linha. Mostra cada item com todos os campos, o status financeiro, o valor final com a multa e o histórico de status (quem, quando, de qual para qual e o motivo). |
| Convite | Página aberta pelo botão "Aceitar convite" do e-mail. Depois de aceitar, leva ao login com o e-mail já preenchido. Link usado ou vencido mostra "Convite expirado ou já usado". |
| Usuários (ADMIN) | Criar com senha provisória (a pessoa recebe o convite por e-mail e só entra depois de aceitar; a situação mostra "Convite pendente até…" ou "Convite expirado", com o botão Reenviar convite), editar nome e perfil, senha provisória, resetar o autenticador, destravar (tentativas erradas), bloquear e excluir. Na sua própria linha só aparece Editar, e o único ADMIN ativo não consegue tirar o próprio perfil de ADMIN. |
| Auditoria (ADMIN) | Tudo o que foi feito, com filtro por ação e período e os valores de antes e depois. |
| Removidos (ADMIN) | Itens tirados das listas, com Restaurar e Excluir de vez. |

## Ações nas P.Os

Os botões aparecem conforme o perfil: o VISUALIZADOR só consulta. A API confere o perfil de novo em cada ação, então esconder os botões é só conveniência.

- **Adicionar**: em qualquer aba. Se o número da P.O já existir, o item entra nela.
- **Editar**: todos os campos menos o status.
- **Mover para…**: escolha o status e, se quiser, o motivo. Para Emitida, o site pede o número da NFS-e e a data de emissão (sem data no futuro) e, se teve multa, o percentual a receber. Antes de gravar aparece um resumo "de → para" para confirmar. Saindo de Emitida para outro status (menos Cancelado), o resumo avisa que a NFS-e será apagada.
- **Remover**: pede confirmação. O item sai das listas, e um ADMIN pode restaurar.
- **Duas pessoas na mesma P.O**: se outra pessoa alterou a P.O depois que você abriu a tela, o site avisa e recarrega, em vez de gravar por cima.

Cada ação mostra uma mensagem de sucesso ou de erro, e as listas, os contadores e a tela inicial se atualizam na hora.

## Sessão

O site renova a sessão sozinho a cada 15 minutos enquanto está em uso. Depois de 30 minutos parado, ou de 12 horas no total, ele volta para o login com o aviso "Sua sessão expirou".

## Como o site fala com a API

No seu computador, o site (`localhost:5173`) repassa os pedidos de `/api` para a API (`localhost:3000`). Para o navegador é tudo um endereço só, e os cookies da sessão (HttpOnly, Secure e SameSite=Strict) funcionam sem abrir CORS. Na AWS (Fase 5), o CloudFront faz esse mesmo papel.

## Testes

As telas foram testadas num navegador (Chromium) com os dados importados da planilha:

- primeiro acesso com QR Code, códigos de recuperação e senha errada;
- adicionar, buscar, mover para Emitida com multa, editar, remover e excluir de vez;
- telas de usuários e auditoria;
- usuário VISUALIZADOR com senha provisória: precisa criar a senha, não vê os botões de alteração nem os menus de ADMIN;
- convite: criar usuário, e-mail recebido no Mailpit, login recusado antes de aceitar, aceitar, entrar com a senha provisória, link usado de novo e reenvio;
- tela de celular, sem rolagem para o lado.

As regras continuam cobertas pelos testes automáticos da API (`npm test`).
