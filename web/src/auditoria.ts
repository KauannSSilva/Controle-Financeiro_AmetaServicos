/** Transforma os registros da auditoria em frases em português, sem códigos nem JSON. */
import { data, quando, reais } from './formato';
import { Perfil, RegistroAuditoria, ROTULO_PERFIL, ROTULO_STATUS, Status } from './tipos';

/** Nome de cada tipo de ação, usado no filtro */
export const ACOES: Record<string, string> = {
  LOGIN_SUCESSO: 'Entrou no site',
  LOGIN_SENHA_OK: 'Acertou a senha (faltava o código)',
  LOGIN_FALHOU: 'Tentativa de entrar que falhou',
  LOGOUT: 'Saiu do site',
  MFA_ATIVADO: 'Cadastrou o autenticador',
  MFA_RECUPERACAO_USADA: 'Usou código de recuperação',
  SENHA_ALTERADA: 'Trocou a própria senha',
  USUARIO_BLOQUEADO_TENTATIVAS: 'Travado por tentativas erradas',
  USUARIO_CRIADO: 'Criou usuário',
  CONVITE_ENVIADO: 'Convite enviado',
  CONVITE_NAO_ENVIADO: 'Convite não enviado',
  CONVITE_ACEITO: 'Convite aceito',
  USUARIO_EDITADO: 'Editou usuário',
  USUARIO_EXCLUIDO: 'Excluiu usuário',
  USUARIO_DESBLOQUEADO: 'Destravou usuário',
  MFA_RESETADO: 'Resetou autenticador',
  SENHA_REDEFINIDA_ADMIN: 'Definiu senha provisória',
  SENHA_REDEFINIDA_CLI: 'Senha do ADMIN redefinida no computador',
  ITEM_CRIADO: 'Adicionou P.O',
  ITEM_EDITADO: 'Editou P.O',
  STATUS_ALTERADO: 'Mudou o status da P.O',
  ITEM_REMOVIDO: 'Removeu P.O',
  ITEM_RESTAURADO: 'Restaurou P.O',
  ITEM_EXCLUIDO_DEFINITIVO: 'Excluiu P.O de vez',
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const st = (v: unknown) => ROTULO_STATUS[v as Status] ?? String(v ?? '—');

/** A frase da coluna "O que aconteceu" */
export function frase(r: RegistroAuditoria): string {
  const alvo = r.alvo ?? '';
  const a = obj(r.valoresAntes);
  const d = obj(r.valoresDepois);
  switch (r.acao) {
    case 'LOGIN_SUCESSO':
      return d.primeiroAcesso ? 'Entrou no site pela primeira vez' : d.metodo === 'recuperacao' ? 'Entrou no site usando um código de recuperação' : 'Entrou no site';
    case 'LOGIN_SENHA_OK': return 'Acertou a senha e foi para o código do autenticador';
    case 'LOGIN_FALHOU':
      if (!r.usuarioId) return 'Alguém tentou entrar com um e-mail que não está cadastrado';
      if (d.motivo === 'convite_pendente') return 'Tentou entrar antes de aceitar o convite do e-mail';
      if (d.motivo === 'usuario_inativo') return 'Tentou entrar, mas o acesso está bloqueado';
      return d.etapa === 'mfa' ? 'Errou o código do autenticador' : 'Errou a senha';
    case 'LOGOUT': return 'Saiu do site';
    case 'MFA_ATIVADO': return 'Cadastrou o autenticador do celular';
    case 'MFA_RECUPERACAO_USADA': return `Usou um código de recuperação${typeof d.restantes === 'number' ? ` (restam ${d.restantes})` : ''}`;
    case 'SENHA_ALTERADA': return 'Trocou a própria senha';
    case 'USUARIO_BLOQUEADO_TENTATIVAS': return `Ficou travado por muitas tentativas erradas${d.ate ? `, até ${quando(String(d.ate))}` : ''}`;
    case 'USUARIO_CRIADO': return `Criou o usuário ${alvo}${d.perfil ? ` como ${ROTULO_PERFIL[d.perfil as Perfil] ?? d.perfil}` : ''}`;
    case 'CONVITE_ENVIADO': return `Enviou o convite por e-mail para ${alvo}`;
    case 'CONVITE_NAO_ENVIADO': return `Tentou enviar o convite para ${alvo}, mas o e-mail não saiu`;
    case 'CONVITE_ACEITO': return 'Aceitou o convite do e-mail';
    case 'USUARIO_EDITADO': {
      const partes: string[] = [];
      if (d.nome) partes.push('mudou o nome');
      if (a.perfil !== d.perfil) partes.push(`mudou o perfil de ${ROTULO_PERFIL[a.perfil as Perfil]} para ${ROTULO_PERFIL[d.perfil as Perfil]}`);
      if (a.ativo !== d.ativo) partes.push(d.ativo ? 'liberou o acesso' : 'bloqueou o acesso');
      return `Editou o usuário ${alvo}${partes.length ? `: ${partes.join(', ')}` : ''}`;
    }
    case 'USUARIO_EXCLUIDO': return `Excluiu o usuário ${alvo}`;
    case 'USUARIO_DESBLOQUEADO': return `Destravou ${alvo} (estava travado por tentativas erradas)`;
    case 'MFA_RESETADO': return `Resetou o autenticador de ${alvo}`;
    case 'SENHA_REDEFINIDA_ADMIN': return `Definiu uma senha provisória para ${alvo}`;
    case 'SENHA_REDEFINIDA_CLI': return `A senha de ${alvo} foi redefinida pelo comando no computador`;
    case 'ITEM_CRIADO': return `Adicionou ${alvo} em ${st(d.status)}`;
    case 'ITEM_EDITADO': {
      const n = mudancas(r).length;
      return `Editou ${alvo}${n ? ` (${n} ${n === 1 ? 'campo' : 'campos'})` : ''}`;
    }
    case 'STATUS_ALTERADO': {
      let f = `Mudou ${alvo} de ${st(a.status)} para ${st(d.status)}`;
      if (d.status === 'EMITIDA' && d.numeroNfse) f += `, NFS-e ${d.numeroNfse} de ${data(String(d.dataEmissao ?? ''))}`;
      if (d.status === 'EMITIDA' && d.possuiMulta) f += ', com multa';
      if (a.numeroNfse && !d.numeroNfse) f += ` (a NFS-e ${a.numeroNfse} foi apagada)`;
      return f;
    }
    case 'ITEM_REMOVIDO': return `Removeu ${alvo} das listas`;
    case 'ITEM_RESTAURADO': return `Restaurou ${alvo}`;
    case 'ITEM_EXCLUIDO_DEFINITIVO': return `Excluiu ${alvo} de vez`;
    default: return ACOES[r.acao] ?? r.acao;
  }
}

const CAMPOS: Record<string, string> = {
  item: 'Item', idSite: 'ID do site', site: 'Site', fase: 'Fase', tecnologia: 'Tecnologia', projeto: 'Projeto', uf: 'UF',
  operadora: 'Cliente', valorOriginal: 'Preço original', percentualMulta: 'Percentual a receber (multa)', possuiMulta: 'Multa',
  status: 'Status', numeroNfse: 'NFS-e', dataEmissao: 'Data de emissão', numeroMigo: 'MIGO', observacoes: 'Observações',
};

function valor(campo: string, v: unknown): string {
  if (v == null || v === '') return '(vazio)';
  if (campo === 'status') return st(v);
  if (campo === 'possuiMulta') return v ? 'Sim' : 'Não';
  if (campo === 'valorOriginal') return reais(v as string);
  if (campo === 'percentualMulta') return `${Number(v)}%`;
  if (campo === 'dataEmissao') return data(String(v));
  return String(v);
}

/** Só os campos que mudaram, já com nome e valor legíveis */
export function mudancas(r: RegistroAuditoria): { campo: string; antes: string; depois: string }[] {
  if (r.acao !== 'ITEM_EDITADO' && r.acao !== 'STATUS_ALTERADO') return [];
  const a = obj(r.valoresAntes);
  const d = obj(r.valoresDepois);
  return Object.keys(CAMPOS)
    .filter((c) => (c in a || c in d) && JSON.stringify(a[c] ?? null) !== JSON.stringify(d[c] ?? null))
    .map((c) => ({ campo: CAMPOS[c], antes: valor(c, a[c]), depois: valor(c, d[c]) }));
}
