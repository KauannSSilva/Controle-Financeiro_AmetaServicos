import { StatusPo } from '@prisma/client';

export const ROTULO_STATUS: Record<StatusPo, string> = {
  AGUARDANDO_LIBERACAO: 'Aguardando Liberação',
  EMITIR_NOTA: 'Emitir Nota',
  EM_EXECUCAO: 'Em Execução',
  EMITIDA: 'Emitida',
  CANCELADO: 'Cancelado',
};

/** Mesma regra da fórmula STATUS FINANCEIRO da planilha. */
export function statusFinanceiro(status: StatusPo): 'FECHADO' | 'ENTREGUE' | 'NOVO' {
  if (status === 'EMITIDA') return 'FECHADO';
  if (status === 'EMITIR_NOTA') return 'ENTREGUE';
  return 'NOVO';
}

/** Valores permitidos na coluna ITEM (decisão da Ameta em 02/10/2026). */
export const ITENS_PERMITIDOS = [
  '10', '20', '30', '40', '50',
  '10 20', '10 20 30', '10 20 30 40', '10 20 30 40 50',
] as const;
