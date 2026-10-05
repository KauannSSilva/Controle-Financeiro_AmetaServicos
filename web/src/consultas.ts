import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/** Depois de qualquer alteração em P.O: listas, contadores, tela inicial e detalhe recarregam. */
export function useRecarregarPos() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const k of ['itens', 'contadores', 'inicio', 'po', 'removidos']) qc.invalidateQueries({ queryKey: [k] });
  }, [qc]);
}
