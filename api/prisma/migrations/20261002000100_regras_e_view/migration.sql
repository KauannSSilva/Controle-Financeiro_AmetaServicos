-- Regras de negócio que o schema do Prisma não expressa.

-- ITEM: valores permitidos pela Ameta (decisão de 02/10/2026)
ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_item_check"
  CHECK ("item" IN ('10', '20', '30', '40', '50', '10 20', '10 20 30', '10 20 30 40', '10 20 30 40 50'));

ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_tecnologia_check"
  CHECK ("tecnologia" IN ('NR', '5G'));

ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_operadora_check"
  CHECK ("operadora" IN ('CLARO', 'VIVO', 'AT&T'));

ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_uf_check"
  CHECK ("uf" ~ '^[A-Z]{2}$');

ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_percentual_multa_check"
  CHECK ("percentual_multa" BETWEEN 0 AND 100);

ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_valor_original_check"
  CHECK ("valor_original" >= 0);

-- Multa só faz sentido em nota emitida
ALTER TABLE "itens_po" ADD CONSTRAINT "itens_po_possui_multa_check"
  CHECK (NOT "possui_multa" OR "status" = 'EMITIDA');

ALTER TABLE "ordens_compra" ADD CONSTRAINT "ordens_compra_numero_po_check"
  CHECK ("numero_po" ~ '^[0-9]+$');

-- Colunas que na planilha são fórmulas viram cálculo na consulta, para nunca ficarem desatualizadas.
-- status_financeiro segue a fórmula da planilha: Emitida = FECHADO, Emitir Nota = ENTREGUE, o resto = NOVO.
-- valor_final segue PREÇO c/MULTA: ORIGINAL x MULTA / 100, ou ORIGINAL quando não há multa.
-- Itens removidos (soft delete) e de P.Os removidas ficam fora da view.
CREATE VIEW "vw_itens_po" AS
SELECT
  i.*,
  o."numero_po",
  CASE i."status"
    WHEN 'EMITIDA' THEN 'FECHADO'
    WHEN 'EMITIR_NOTA' THEN 'ENTREGUE'
    ELSE 'NOVO'
  END AS "status_financeiro",
  ROUND(COALESCE(i."valor_original", 0) * COALESCE(i."percentual_multa", 100) / 100, 2) AS "valor_final",
  COALESCE(i."valor_original", 0)
    - ROUND(COALESCE(i."valor_original", 0) * COALESCE(i."percentual_multa", 100) / 100, 2) AS "valor_multa",
  EXTRACT(MONTH FROM i."data_emissao")::int AS "mes_emissao"
FROM "itens_po" i
JOIN "ordens_compra" o ON o."id" = i."ordem_compra_id"
WHERE i."excluido_em" IS NULL
  AND o."excluido_em" IS NULL;
