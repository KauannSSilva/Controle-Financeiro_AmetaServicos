import { FormEvent, useState } from 'react';
import { api, ErroApi } from '../api';
import { useRecarregarPos } from '../consultas';
import { data as fmtData, hojeIso } from '../formato';
import { Item, ROTULO_STATUS, Status, STATUS } from '../tipos';
import { Alerta, AreaTexto, Botao, Campo, Selecao, SeloStatus, useAvisos } from './ui';

export function MoverStatus({ item, aoConcluir, aoCancelar }: { item: Item; aoConcluir: () => void; aoCancelar: () => void }) {
  const [para, setPara] = useState<Status | ''>('');
  const [motivo, setMotivo] = useState('');
  const [numeroNfse, setNumeroNfse] = useState(item.numeroNfse ?? '');
  const [dataEmissao, setDataEmissao] = useState(item.dataEmissao?.slice(0, 10) ?? hojeIso());
  const [multa, setMulta] = useState(item.possuiMulta);
  const [percentual, setPercentual] = useState(item.percentualMulta ?? '');
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = useRecarregarPos();
  const avisar = useAvisos();

  const paraEmitida = para === 'EMITIDA';
  const mesmo = para === item.status && (!paraEmitida || multa === item.possuiMulta);

  function revisar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!para) return setErro('Escolha o novo status.');
    if (mesmo) return setErro('A P.O já está neste status.');
    if (paraEmitida && (!numeroNfse.trim() || !dataEmissao)) return setErro('Para Emitida, informe o número da NFS-e e a data de emissão.');
    if (paraEmitida && dataEmissao > hojeIso()) return setErro('A data de emissão não pode ser no futuro.');
    if (paraEmitida && multa && (percentual === '' || Number(String(percentual).replace(',', '.')) > 100)) return setErro('Com multa, informe o percentual a receber (0 a 100).');
    setConfirmando(true);
  }

  async function confirmar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`itens/${item.id}/mover`, {
        para,
        motivo: motivo || undefined,
        versao: item.atualizadoEm,
        ...(paraEmitida
          ? { numeroNfse, dataEmissao, possuiMulta: multa, ...(multa ? { percentualMulta: String(percentual).replace(',', '.') } : {}) }
          : {}),
      });
      avisar('sucesso', `P.O ${item.numeroPo} movida para ${ROTULO_STATUS[para as Status]}${paraEmitida && multa ? ' com multa' : ''}.`);
      recarregar();
      aoConcluir();
    } catch (e) {
      setConfirmando(false);
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível mover.');
      if (e instanceof ErroApi && e.status === 409) recarregar();
    } finally {
      setOcupado(false);
    }
  }

  if (confirmando && para) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-700">Confirma a mudança?</p>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-3 text-sm">
          <SeloStatus status={item.status} rotulo={ROTULO_STATUS[item.status]} multa={item.status === 'EMITIDA' && item.possuiMulta} />
          <span aria-hidden>→</span>
          <SeloStatus status={para} rotulo={ROTULO_STATUS[para]} multa={paraEmitida && multa} />
        </div>
        {paraEmitida && (
          <ul className="text-sm text-slate-700">
            <li>NFS-e: <b>{numeroNfse}</b></li>
            <li>Emissão: <b>{fmtData(dataEmissao)}</b></li>
            {multa && <li>Recebe: <b>{percentual}%</b> do valor</li>}
          </ul>
        )}
        {motivo && <p className="text-sm text-slate-700">Motivo: {motivo}</p>}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setConfirmando(false)}>Voltar</Botao>
          <Botao onClick={confirmar} disabled={ocupado}>{ocupado ? 'Gravando…' : 'Confirmar'}</Botao>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={revisar} className="space-y-4">
      <p className="text-sm text-slate-600">Status atual: <SeloStatus status={item.status} rotulo={item.rotuloStatus} multa={item.status === 'EMITIDA' && item.possuiMulta} /></p>
      <Selecao rotulo="Mover para" value={para} onChange={(e) => setPara(e.target.value as Status)} obrigatorio autoFocus>
        <option value="">Escolha…</option>
        {STATUS.map((s) => (
          <option key={s.valor} value={s.valor} disabled={s.valor === item.status && s.valor !== 'EMITIDA'}>{ROTULO_STATUS[s.valor]}</option>
        ))}
      </Selecao>
      {paraEmitida && (
        <div className="space-y-4 rounded-md border border-slate-200 p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Número da NFS-e" value={numeroNfse} onChange={(e) => setNumeroNfse(e.target.value)} maxLength={30} obrigatorio />
            <Campo rotulo="Data de emissão" type="date" value={dataEmissao} max={hojeIso()} onChange={(e) => setDataEmissao(e.target.value)} obrigatorio />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={multa} onChange={(e) => setMulta(e.target.checked)} className="h-4 w-4" />
            Teve multa
          </label>
          {multa && (
            <Campo rotulo="Percentual a receber (%)" inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)}
              ajuda="Ex.: 88 = recebe 88% do valor (multa de 12%)." obrigatorio />
          )}
        </div>
      )}
      <AreaTexto rotulo="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
      {erro && <Alerta>{erro}</Alerta>}
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>
        <Botao type="submit">Continuar</Botao>
      </div>
    </form>
  );
}
