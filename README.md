# Controle Financeiro Ameta Serviços

Aplicação web que substitui a planilha de controle de NFS-e e P.Os da Ameta Serviços.

## Andamento

- **Fase 0 — Análise da planilha:** [docs/fase-0-analise.md](docs/fase-0-analise.md)

## Reproduzir a análise da Fase 0

A planilha contém dados de clientes e fica fora do Git. Coloque o arquivo em `data/` e rode:

```bash
pip install openpyxl
python3 scripts/fase0/analisar_planilha.py data/Controle_AMETA_4.xlsx data/fase0
```
