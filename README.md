# Controle Financeiro Ameta Serviços

Aplicação web que substitui a planilha de controle de NFS-e e P.Os da Ameta Serviços.

## Andamento

- **Fase 0 — Análise da planilha:** [docs/fase-0-analise.md](docs/fase-0-analise.md)
- **Fase 1 — Banco de dados:** [docs/fase-1-banco-de-dados.md](docs/fase-1-banco-de-dados.md)

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

## Dados de clientes

A planilha e os relatórios da importação ficam fora do Git (`data/`, `*.xlsx`, `*.csv` no `.gitignore`). O repositório é público: nunca adicione esses arquivos.

## Reproduzir a análise da Fase 0

```bash
pip install openpyxl
python3 scripts/fase0/analisar_planilha.py data/Controle_AMETA_4.xlsx data/fase0
```
