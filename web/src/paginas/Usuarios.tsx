import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Campo, Carregando, Confirmar, Modal, Selecao, useAvisos } from '../componentes/ui';
import { quando } from '../formato';
import { Perfil, ROTULO_PERFIL, Usuario } from '../tipos';
type Acao =
  | { tipo: 'criar' }
  | { tipo: 'editar'; u: Usuario }
  | { tipo: 'senha'; u: Usuario }
  | { tipo: 'convite'; u: Usuario }
  | { tipo: 'confirmar'; u: Usuario; titulo: string; mensagem: string; rotulo: string; perigo?: boolean; executar: () => Promise<unknown>; sucesso: string };

type Concluir = (msg: string, tipo?: 'sucesso' | 'erro') => void;

function FormUsuario({ u, aoConcluir, aoCancelar }: { u?: Usuario; aoConcluir: Concluir; aoCancelar: () => void }) {
  const [nome, setNome] = useState(u?.nome ?? '');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<Perfil>(u?.perfil ?? 'OPERADOR');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      if (u) {
        const corpo: Record<string, string> = {};
        if (nome !== u.nome) corpo.nome = nome;
        if (perfil !== u.perfil) corpo.perfil = perfil;
        if (Object.keys(corpo).length) await api.patch(`usuarios/${u.id}`, corpo);
        aoConcluir(`${nome} atualizado.`);
      } else {
        const r = await api.post<{ conviteEnviado: boolean }>('usuarios', { nome, email, perfil, senhaProvisoria: senha });
        if (r.conviteEnviado) aoConcluir(`${nome} criado. O convite foi enviado para ${email}.`);
        else aoConcluir(`${nome} criado, mas o e-mail do convite não saiu. Use "Reenviar convite" na lista.`, 'erro');
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} obrigatorio autoFocus />
      {!u && <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} obrigatorio autoComplete="off" />}
      <Selecao rotulo="Perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}
        ajuda="Administrador: tudo. Operador: adiciona, edita, move e remove P.Os. Visualizador: só consulta.">
        {(['ADMIN', 'OPERADOR', 'VISUALIZADOR'] as Perfil[]).map((p) => <option key={p} value={p}>{ROTULO_PERFIL[p]}</option>)}
      </Selecao>
      {!u && (
        <Campo rotulo="Senha provisória" type="text" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={12} maxLength={128} obrigatorio autoComplete="new-password"
          ajuda="Pelo menos 12 caracteres. Vai no e-mail do convite; a pessoa troca no primeiro acesso e cadastra o autenticador." />
      )}
      {!u && <p className="text-sm text-slate-600">A pessoa recebe um convite por e-mail com o nome, o e-mail e a senha provisória, e só consegue entrar depois de aceitar.</p>}
      {erro && <Alerta>{erro}</Alerta>}
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>
        <Botao type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : u ? 'Salvar' : 'Criar usuário'}</Botao>
      </div>
    </form>
  );
}

function FormSenhaProvisoria({ u, convite, aoConcluir, aoCancelar }: { u: Usuario; convite?: boolean; aoConcluir: Concluir; aoCancelar: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      if (convite) {
        const r = await api.post<{ conviteEnviado: boolean }>(`usuarios/${u.id}/reenviar-convite`, { senhaProvisoria: senha });
        if (r.conviteEnviado) aoConcluir(`Convite reenviado para ${u.email}.`);
        else aoConcluir('O e-mail do convite não saiu. Confira a configuração de e-mail e tente de novo.', 'erro');
      } else {
        await api.post(`usuarios/${u.id}/senha-provisoria`, { senhaProvisoria: senha });
        aoConcluir(`Senha provisória definida para ${u.nome}. Ela troca no próximo acesso.`);
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-slate-600">
        {convite
          ? `Manda um convite novo para ${u.email} com esta senha provisória. O link e a senha do convite anterior deixam de valer.`
          : 'Use quando a pessoa esqueceu a senha. As sessões abertas dela são encerradas.'}
      </p>
      <Campo rotulo="Nova senha provisória" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={12} maxLength={128} obrigatorio autoFocus autoComplete="new-password" />
      {erro && <Alerta>{erro}</Alerta>}
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>
        <Botao type="submit" disabled={ocupado}>{convite ? (ocupado ? 'Enviando…' : 'Reenviar convite') : 'Definir'}</Botao>
      </div>
    </form>
  );
}

export function Usuarios() {
  const { usuario: eu } = useAuth();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [acao, setAcao] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const lista = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<Usuario[]>('usuarios') });

  const fechar = () => { setAcao(null); setErro(null); };
  const concluir: Concluir = (msg, tipo = 'sucesso') => { fechar(); avisar(tipo, msg); qc.invalidateQueries({ queryKey: ['usuarios'] }); };
  const confirmar = (u: Usuario, titulo: string, mensagem: string, rotulo: string, executar: () => Promise<unknown>, sucesso: string, perigo = false) =>
    setAcao({ tipo: 'confirmar', u, titulo, mensagem, rotulo, executar, sucesso, perigo });

  async function executarConfirmado() {
    if (acao?.tipo !== 'confirmar') return;
    setOcupado(true);
    try {
      await acao.executar();
      concluir(acao.sucesso);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Usuários</h1>
        <Botao onClick={() => setAcao({ tipo: 'criar' })}>+ Novo usuário</Botao>
      </div>
      {lista.isLoading && <Carregando />}
      {lista.isError && <Alerta>{(lista.error as Error).message}</Alerta>}
      {lista.data && (
        <div className="relative overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2.5">Nome</th><th className="px-3 py-2.5">E-mail</th><th className="px-3 py-2.5">Perfil</th>
                <th className="px-3 py-2.5">Situação</th><th className="px-3 py-2.5">Criado em</th><th className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.data.map((u) => {
                const souEu = u.id === eu?.id;
                return (
                  <tr key={u.id}>
                    <td className="px-3 py-2 font-medium text-slate-900">{u.nome}{souEu && <span className="ml-1 text-xs text-slate-500">(você)</span>}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{ROTULO_PERFIL[u.perfil]}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 text-xs">
                        {!u.ativo ? <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">Bloqueado</span> : <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">Ativo</span>}
                        {u.bloqueadoAte && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Travado por tentativas até {quando(u.bloqueadoAte)}</span>}
                        {!u.conviteAceito && (u.conviteExpiraEm && new Date(u.conviteExpiraEm) > new Date()
                          ? <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900">Convite pendente até {quando(u.conviteExpiraEm)}</span>
                          : <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-900">Convite expirado</span>)}
                        {u.conviteAceito && !u.mfaAtivo && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">Autenticador pendente</span>}
                        {u.deveTrocarSenha && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">Senha provisória</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{quando(u.criadoEm)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => setAcao({ tipo: 'editar', u })}>Editar</Botao>
                        {!souEu && (
                          <>
                            {!u.conviteAceito
                              ? <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => setAcao({ tipo: 'convite', u })}>Reenviar convite</Botao>
                              : <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => setAcao({ tipo: 'senha', u })}>Senha provisória</Botao>}
                            {u.conviteAceito && <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => confirmar(u, 'Resetar o autenticador?', `${u.nome} vai cadastrar o QR Code de novo no próximo acesso (ex.: trocou de celular). As sessões abertas são encerradas.`, 'Resetar', () => api.post(`usuarios/${u.id}/resetar-mfa`), `Autenticador de ${u.nome} resetado.`)}>Resetar MFA</Botao>}
                            {u.bloqueadoAte && (
                              <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => confirmar(u, 'Destravar?', `Libera ${u.nome}, travado por tentativas erradas.`, 'Destravar', () => api.post(`usuarios/${u.id}/desbloquear`), `${u.nome} destravado.`)}>Destravar</Botao>
                            )}
                            {u.ativo
                              ? <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => confirmar(u, 'Bloquear acesso?', `${u.nome} não consegue mais entrar até ser desbloqueado. As sessões abertas são encerradas.`, 'Bloquear', () => api.patch(`usuarios/${u.id}`, { ativo: false }), `${u.nome} bloqueado.`, true)}>Bloquear</Botao>
                              : <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => confirmar(u, 'Desbloquear acesso?', `${u.nome} volta a poder entrar.`, 'Desbloquear', () => api.patch(`usuarios/${u.id}`, { ativo: true }), `${u.nome} desbloqueado.`)}>Desbloquear</Botao>}
                            <Botao variante="fantasma" className="px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => confirmar(u, 'Excluir usuário?', `${u.nome} perde o acesso de vez. O que fez continua no histórico e na auditoria.`, 'Excluir', () => api.delete(`usuarios/${u.id}`), `${u.nome} excluído.`, true)}>Excluir</Botao>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal titulo="Novo usuário" aberto={acao?.tipo === 'criar'} aoFechar={fechar}>
        <FormUsuario aoConcluir={concluir} aoCancelar={fechar} />
      </Modal>
      <Modal titulo="Editar usuário" aberto={acao?.tipo === 'editar'} aoFechar={fechar}>
        {acao?.tipo === 'editar' && <FormUsuario u={acao.u} aoConcluir={concluir} aoCancelar={fechar} />}
      </Modal>
      <Modal titulo="Senha provisória" aberto={acao?.tipo === 'senha'} aoFechar={fechar}>
        {acao?.tipo === 'senha' && <FormSenhaProvisoria u={acao.u} aoConcluir={concluir} aoCancelar={fechar} />}
      </Modal>
      <Modal titulo="Reenviar convite" aberto={acao?.tipo === 'convite'} aoFechar={fechar}>
        {acao?.tipo === 'convite' && <FormSenhaProvisoria u={acao.u} convite aoConcluir={concluir} aoCancelar={fechar} />}
      </Modal>
      <Confirmar aberto={acao?.tipo === 'confirmar'} titulo={acao?.tipo === 'confirmar' ? acao.titulo : ''} mensagem={acao?.tipo === 'confirmar' ? acao.mensagem : ''}
        rotulo={acao?.tipo === 'confirmar' ? acao.rotulo : ''} perigo={acao?.tipo === 'confirmar' && acao.perigo} ocupado={ocupado} erro={erro}
        aoConfirmar={executarConfirmado} aoFechar={fechar} />
    </div>
  );
}
