import { describe, expect, it } from 'vitest';
import { data, dinheiro, LinhaBruta, normalizarLinha, texto } from '../src/importacao/normalizar.js';

const base: LinhaBruta = {
  status: 'EMITIDA NOTA FISCAL',
  po: 4533000001,
  item: 10,
  fase: 'K2552',
  tecnologia: '5G',
  operadora: 'CLARO',
  uf: 'SP',
  precoOriginal: 350,
  precoComMulta: 350,
  nfse: 38000,
  dataEmissao: new Date(Date.UTC(2026, 2, 19)),
  statusFinanceiro: 'FECHADO',
};

function ok(linha: LinhaBruta) {
  const r = normalizarLinha(2, linha);
  if (!r.ok) throw new Error(`rejeitada: ${r.motivo}`);
  return r;
}

describe('conversões', () => {
  it('limpa espaços, inclusive o não separável', () => {
    expect(texto(' 35075 ')).toBe('35075');
    expect(texto('   ')).toBeNull();
  });

  it('lê valores no formato brasileiro', () => {
    expect(dinheiro(97.9)).toBe('97.90');
    expect(dinheiro('1.234,56')).toBe('1234.56');
    expect(dinheiro('R$ 50,30')).toBe('50.30');
    expect(dinheiro('abc')).toBeUndefined();
  });

  it('lê datas do Excel e em texto', () => {
    expect(data('10/08/2026')).toEqual(new Date(Date.UTC(2026, 7, 10)));
    expect(data('2026-08-10')).toEqual(new Date(Date.UTC(2026, 7, 10)));
    expect(data('31/02/2026')).toBeUndefined();
  });
});

describe('normalizarLinha', () => {
  it('importa uma linha comum', () => {
    const r = ok(base);
    expect(r.item).toMatchObject({ numeroPo: '4533000001', item: '10', status: 'EMITIDA', possuiMulta: false, valorOriginal: '350.00' });
    expect(r.avisos).toEqual([]);
  });

  it('tira os apóstrofos usados para repetir a P.O', () => {
    expect(ok({ ...base, po: "4533171015'''" }).item.numeroPo).toBe('4533171015');
    expect(ok({ ...base, po: '4533171015´´' }).item.numeroPo).toBe('4533171015');
  });

  it('emitida c/ multa vira EMITIDA com possui_multa', () => {
    const r = ok({ ...base, status: 'EMITIDA NOTA FISCAL C/ MULTA', multa: 88, precoOriginal: 3135, precoComMulta: 2758.8 });
    expect(r.item).toMatchObject({ status: 'EMITIDA', possuiMulta: true, percentualMulta: '88.00', statusOrigem: 'EMITIDA NOTA FISCAL C/ MULTA' });
  });

  it.each([
    ['CANCELADO', 'CANCELADO'],
    ['NOTA DUPLICADA CANCELADA', 'CANCELADO'],
    ['P.O CANCELADO', 'CANCELADO'],
    ['PEDIDO CANCELADO', 'CANCELADO'],
    ['SITE CANCELADO', 'CANCELADO'],
    ['PENDENTE', 'EM_EXECUCAO'],
    ['Aguardando Liberação', 'AGUARDANDO_LIBERACAO'],
    ['EMITIR NOTA', 'EMITIR_NOTA'],
  ])('mapeia o status "%s" para %s', (origem, esperado) => {
    expect(ok({ ...base, status: origem, nfse: null, statusFinanceiro: null }).item.status).toBe(esperado);
  });

  it('aceita os itens agrupados da lista', () => {
    expect(ok({ ...base, item: '10 20 30 40' }).item.item).toBe('10 20 30 40');
    expect(ok({ ...base, item: null }).item.item).toBeNull();
  });

  it.each([
    [{ status: 'QUALQUER COISA' }, 'STATUS não reconhecido'],
    [{ status: null }, 'STATUS vazio'],
    [{ po: null }, 'P.O vazia'],
    [{ item: '10 30' }, 'ITEM fora da lista'],
    [{ precoOriginal: 'abc' }, 'PREÇO ORIGINAL inválido'],
    [{ dataEmissao: 'ontem' }, 'não é uma data'],
    [{ operadora: 'TIM' }, 'OPERADORA desconhecida'],
  ] as [LinhaBruta, string][])('rejeita %o', (mudanca, motivo) => {
    const r = normalizarLinha(2, { ...base, ...mudanca });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain(motivo);
  });

  it('importa com aviso os casos que precisam de conferência', () => {
    const r = ok({ ...base, dataEmissao: new Date(Date.UTC(2006, 7, 10)), nfse: 'CONTABILIZADA', statusFinanceiro: 'ENTREGUE' });
    const motivos = r.avisos.map((a) => a.motivo).join(' | ');
    expect(motivos).toContain('2006');
    expect(motivos).toContain('não numérico');
    expect(motivos).toContain('STATUS FINANCEIRO digitado');
  });
});
