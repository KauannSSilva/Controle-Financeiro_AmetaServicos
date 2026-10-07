/**
 * Envio de e-mails (convites). No seu computador, o Mailpit (docker compose) recebe tudo
 * e mostra em http://localhost:8025; nada sai para a internet. Em produção, o SMTP da Ameta ou o SES.
 */
import nodemailer from 'nodemailer';
import { Config } from '../config.js';

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

export type EnviarEmail = (m: Email) => Promise<void>;

export function criarEnvioSmtp(config: Config): EnviarEmail {
  const transporte = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORTA,
    secure: config.SMTP_SEGURO,
    auth: config.SMTP_USUARIO ? { user: config.SMTP_USUARIO, pass: config.SMTP_SENHA ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return async (m) => {
    await transporte.sendMail({ from: config.EMAIL_REMETENTE, to: m.para, subject: m.assunto, text: m.texto, html: m.html });
  };
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const dataHora = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function emailConvite(d: { nome: string; email: string; senhaProvisoria: string; link: string; expiraEm: Date }): Omit<Email, 'para'> {
  const expira = dataHora(d.expiraEm);
  const texto = [
    `Olá, ${d.nome}.`,
    '',
    'Você foi convidado(a) para o Controle Financeiro da Ameta Serviços.',
    '',
    `Nome no site: ${d.nome}`,
    `E-mail de acesso: ${d.email}`,
    `Senha provisória: ${d.senhaProvisoria}`,
    '',
    `1. Aceite o convite neste link (vale até ${expira}):`,
    d.link,
    '2. Entre com o e-mail e a senha provisória acima.',
    '3. Crie a sua própria senha.',
    '4. Cadastre o autenticador (Google Authenticator ou Microsoft Authenticator) com o QR Code.',
    '',
    'Se você não esperava este convite, ignore este e-mail.',
  ].join('\n');
  const n = escapar(d.nome);
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#111555;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Controle Financeiro · Ameta Serviços</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 16px">Olá, <strong>${n}</strong>.</p>
<p style="margin:0 0 16px">Você foi convidado(a) para o Controle Financeiro da Ameta Serviços. Estes são os seus dados de acesso:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin:0 0 20px">
<tr><td style="padding:10px 14px;color:#475569;width:150px">Nome no site</td><td style="padding:10px 14px"><strong>${n}</strong></td></tr>
<tr><td style="padding:10px 14px;color:#475569">E-mail de acesso</td><td style="padding:10px 14px"><strong>${escapar(d.email)}</strong></td></tr>
<tr><td style="padding:10px 14px;color:#475569">Senha provisória</td><td style="padding:10px 14px;font-family:Consolas,monospace;font-size:15px"><strong>${escapar(d.senhaProvisoria)}</strong></td></tr>
</table>
<p style="margin:0 0 20px;text-align:center"><a href="${escapar(d.link)}" style="display:inline-block;background:#439295;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:6px">Aceitar convite</a></p>
<p style="margin:0 0 8px;color:#475569;font-size:14px">O convite vale até ${escapar(expira)}. Depois de aceitar:</p>
<ol style="margin:0 0 16px;padding-left:20px;color:#475569;font-size:14px;line-height:1.6">
<li>Entre com o e-mail e a senha provisória acima.</li>
<li>Crie a sua própria senha.</li>
<li>Cadastre o autenticador (Google Authenticator ou Microsoft Authenticator) com o QR Code.</li>
</ol>
<p style="margin:0;color:#94a3b8;font-size:12px">Se o botão não abrir, copie este endereço no navegador: ${escapar(d.link)}<br>Se você não esperava este convite, ignore este e-mail.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { assunto: 'Convite para o Controle Financeiro da Ameta Serviços', texto, html };
}
