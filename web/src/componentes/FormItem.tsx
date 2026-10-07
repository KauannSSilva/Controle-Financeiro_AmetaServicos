import { FormEvent, useState } from 'react';
import { api, ErroApi } from '../api';
import { useRecarregarPos } from '../consultas';
import { hojeIso } from '../formato';
import { Item, ITENS_PERMITIDOS, OPERADORAS, Status, STATUS, ROTULO_STATUS } from '../tipos';
import { Alerta, AreaTexto, Botao, Campo, Selecao, useAvisos } from './ui';

const CAMPOS = ['item', 'idSite', 'site', 'fase', 'tecnologia', 'projeto', 'uf', 'operadora', 'valorOriginal', 'percentualMulta', 'numeroNfse', 'dataEmissao', 'numeroMigo', 'observacoes'] as const;
type Campo = (typeof CAMPOS)[number];
type Valores = Record<Campo, string>;

function valoresDe(item?: Item): Valores {
  const v = {} as Valores;
  for (const c of CAMPOS) {
    const x = item?.[c];
    v[c] = x == null ? '' : c === 'dataEmissao' ? String(x).slice(0, 10) : String(x);
  }
  return v;
}

/** Converte o formulário no corpo da API: vazio vira null, vírgula decimal vira ponto. */
function paraApi(c: Campo, v: string) {
  const t = v.trim();
  if (t === '') return null;
  // "1.234,56" -> "1234.56"; "1234.56" fica como está
  if (c === 'valorOriginal' || c === 'percentualMulta') return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return t;
}

/** Adicionar (sem item) ou editar (com item). O status muda pela ação "Mover para…". */
export function FormItem({ item, statusInicial, aoConcluir, aoCancelar }: { item?: Item; statusInicial?: Status; aoConcluir: () => void; aoCancelar: () => void }) {
  const original = valoresDe(item);
  const [v, setV] = useState<Valores>(original);
  const [numeroPo, setNumeroPo] = useState('');
  const [status, setStatus] = useState<Status>(statusInicial ?? 'AGUARDANDO_LIBERACAO');
  const [multa, setMulta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = useRecarregarPos();
  const avisar = useAvisos();
  const editando = !!item;
  const emitida = editando ? item.status === 'EMITIDA' : status === 'EMITIDA';
  const comMulta = editando ? item.possuiMulta : multa;

  const mudar = (c: Campo) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [c]: e.target.value }));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      if (editando) {
        const corpo: Record<string, unknown> = { versao: item.atualizadoEm };
        for (const c of CAMPOS) if (v[c] !== original[c]) corpo[c] = paraApi(c, v[c]);
        if (Object.keys(corpo).length === 1) return aoConcluir();
        await api.patch(`itens/${item.id}`, corpo);
        avisar('sucesso', `P.O ${item.numeroPo} atualizada.`);
      } else {
        const corpo: Record<string, unknown> = { numeroPo: numeroPo.replace(/\D/g, ''), status, possuiMulta: emitida ? multa : undefined };
        for (const c of CAMPOS) {
          const x = paraApi(c, v[c]);
          if (x !== null) corpo[c] = x;
        }
        await api.post('itens', corpo);
        avisar('sucesso', `P.O ${corpo.numeroPo} adicionada em ${ROTULO_STATUS[status]}.`);
      }
      recarregar();
      aoConcluir();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
      if (e instanceof ErroApi && e.status === 409) recarregar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {!editando && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Número da P.O" inputMode="numeric" value={numeroPo} onChange={(e) => setNumeroPo(e.target.value)} maxLength={20} obrigatorio autoFocus
            ajuda="Se a P.O já existir, o item entra nela." />
          <Selecao rotulo="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUS.map((s) => <option key={s.valor} value={s.valor}>{ROTULO_STATUS[s.valor]}</option>)}
          </Selecao>
          {emitida && (
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={multa} onChange={(e) => setMulta(e.target.checked)} className="h-4 w-4" /> Teve multa
            </label>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Selecao rotulo="Item" value={v.item} onChange={mudar('item')}>
          <option value="">—</option>
          {ITENS_PERMITIDOS.map((i) => <option key={i} value={i}>{i}</option>)}
        </Selecao>
        <Campo rotulo="ID do site" value={v.idSite} onChange={mudar('idSite')} maxLength={50} />
        <Campo rotulo="Site" value={v.site} onChange={mudar('site')} maxLength={100} />
        <Campo rotulo="Fase" value={v.fase} onChange={mudar('fase')} maxLength={20} />
        <Selecao rotulo="Tecnologia" value={v.tecnologia} onChange={mudar('tecnologia')}>
          <option value="">—</option><option>NR</option><option>5G</option>
        </Selecao>
        <Campo rotulo="Projeto" value={v.projeto} onChange={mudar('projeto')} maxLength={150} />
        <Selecao rotulo="Cliente (operadora)" value={v.operadora} onChange={mudar('operadora')}>
          <option value="">—</option>
          {OPERADORAS.map((o) => <option key={o}>{o}</option>)}
        </Selecao>
        <Campo rotulo="UF" value={v.uf} onChange={(e) => setV((x) => ({ ...x, uf: e.target.value.toUpperCase() }))} maxLength={2} />
        <Campo rotulo="Preço original (R$)" inputMode="decimal" value={v.valorOriginal} onChange={mudar('valorOriginal')} placeholder="1234,56" />
      </div>
      {(emitida || v.numeroNfse || v.dataEmissao) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Número da NFS-e" value={v.numeroNfse} onChange={mudar('numeroNfse')} maxLength={30} obrigatorio={emitida} />
          <Campo rotulo="Data de emissão" type="date" max={hojeIso()} value={v.dataEmissao} onChange={mudar('dataEmissao')} obrigatorio={emitida} />
          {comMulta && <Campo rotulo="Percentual a receber (%)" inputMode="decimal" value={v.percentualMulta} onChange={mudar('percentualMulta')} obrigatorio ajuda="88 = recebe 88%" />}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Número MIGO" value={v.numeroMigo} onChange={mudar('numeroMigo')} maxLength={30} />
      </div>
      <AreaTexto rotulo="Observações" value={v.observacoes} onChange={mudar('observacoes')} maxLength={2000} />
      {erro && <Alerta>{erro}</Alerta>}
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>
        <Botao type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : editando ? 'Salvar' : 'Adicionar'}</Botao>
      </div>
    </form>
  );
}
