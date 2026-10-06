# Controle Financeiro Ameta Serviços

Aplicação web que substitui a planilha de controle de NFS-e e P.Os da Ameta Serviços.

## Andamento

- **Fase 0 — Análise da planilha:** [docs/fase-0-analise.md](docs/fase-0-analise.md)
- **Fase 1 — Banco de dados:** [docs/fase-1-banco-de-dados.md](docs/fase-1-banco-de-dados.md)
- **Fase 2 — API, login com MFA e perfis:** [docs/fase-2-api.md](docs/fase-2-api.md)
- **Fase 4 — Segurança (OWASP Top 10 / ASVS L2):** [docs/fase-4-seguranca.md](docs/fase-4-seguranca.md) · rotas: [docs/inventario-rotas.md](docs/inventario-rotas.md)

## Rodar o banco no seu computador (grátis)

Precisa de:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (gratuito para uso pessoal e empresas pequenas)
- [Node.js 22 LTS](https://nodejs.org/)
- Git

Passo a passo, num terminal na pasta do projeto:

```bash
# 1. Configuração: copie o exemplo e troque a senha (nas duas linhas onde ela aparece)
cp .env.example .env

# 2. Dependências
npm install

# 3. Sobe o PostgreSQL 16
npm run db:up

# 4. Cria as tabelas
npm run db:migrate

# 5. Importa a planilha (coloque o arquivo na pasta data/, que fica fora do Git)
npm run import:planilha -- --file ./data/Controle_AMETA_12.xlsx

# 6. Testes
npm test
```

No Windows, use `copy .env.example .env` no passo 1.

Para ver as tabelas, rode `npm run db:studio` e abra o endereço que aparecer, ou conecte um cliente como DBeaver ou pgAdmin em `localhost:5432` com o usuário e a senha do `.env`.

Para desligar o banco: `npm run db:down` (os dados continuam salvos no volume do Docker).

## API (Fase 2)

Com o banco rodando (passos acima), no PowerShell, dentro da pasta do projeto:

```powershell
# 1. Atualiza dependências e banco
npm install
npm -w api run db:generate
npm run db:migrate

# 2. Gera as chaves da API no .env (só na primeira vez)
npm run api:chaves

# 3. Cria o primeiro ADMIN (pede o nome e a senha, que não aparece na tela)
npm run seed:admin -- --email voce@ameta.com.br

# 4. Sobe a API (deixe esta janela aberta; Ctrl+C para parar)
npm run api
```

Abra `http://localhost:3000/api/v1/docs` no navegador para testar:

1. **auth/login** → *Try it out* → troque e-mail e senha → *Execute*.
2. **auth/mfa/configurar** → *Try it out* → *Execute*. Abra `http://localhost:3000/api/v1/auth/mfa/qrcode.png` em outra aba e escaneie com o Google Authenticator ou o Microsoft Authenticator.
3. **auth/mfa/ativar** com o código de 6 dígitos do app. Guarde os 10 códigos de recuperação que aparecem.
4. Pronto: as outras rotas funcionam (ex.: **contadores**, **inicio**, **itens**). Nos próximos acessos, o passo 2 é **auth/mfa/verificar** com o código do app.

Se a senha do ADMIN não entrar, troque-a com `npm run seed:admin -- --email voce@ameta.com.br --redefinir-senha` (também tira o bloqueio por tentativas).

Não troque `CHAVE_CRIPTOGRAFIA` nem `CHAVE_HMAC` depois de criar usuários: os dados cifrados ficariam ilegíveis.

## Site (Fase 3)

Precisa de **duas janelas** do PowerShell abertas na pasta do projeto: uma para a API e outra para o site.

```powershell
# Uma vez, depois de baixar a versão nova
git pull
npm install
npm -w api run db:generate

# Janela 1: banco e API (deixe aberta)
npm run db:up
npm run api

# Janela 2: site (deixe aberta)
npm run site
```

Abra `http://localhost:5173` no navegador e entre com o seu e-mail, a senha e o código do app. Para parar, use Ctrl+C em cada janela.

O que cada tela faz está em [docs/fase-3-telas.md](docs/fase-3-telas.md).

### E-mails de convite

Quem você cria em Usuários recebe um convite por e-mail. No seu computador, os e-mails não saem para a internet: o `npm run db:up` também liga o **Mailpit**, e você vê tudo o que a API enviou em `http://localhost:8025`. Para enviar de verdade (na Fase 5), troque as linhas `SMTP_` do `.env` pelo servidor de e-mail da empresa.

## Tudo em contêineres (Fase 4)

Com o `.env` pronto (`npm run api:chaves` já rodado), um comando sobe banco, Mailpit, migrações, API e site:

```powershell
npm run tudo
```

Abra `http://localhost:8080`. Para parar: `npm run db:down`. O modo com `npm run api` e `npm run site` continua funcionando (site em `http://localhost:5173`); não use os dois ao mesmo tempo.

## Verificação de segurança

```powershell
npm run security:scan
```

Confere se o `.env` está fora do Git, procura segredos no histórico (gitleaks, precisa do Docker), roda o `npm audit` e confirma que o site gerado não tem nenhum valor do `.env`.

## Dados de clientes

A planilha e os relatórios da importação ficam fora do Git (`data/`, `*.xlsx`, `*.csv` no `.gitignore`). O repositório é público: nunca adicione esses arquivos.

## Reproduzir a análise da Fase 0

```bash
pip install openpyxl
python3 scripts/fase0/analisar_planilha.py data/Controle_AMETA_4.xlsx data/fase0
```
