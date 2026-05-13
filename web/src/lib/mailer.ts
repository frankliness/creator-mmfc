import nodemailer, { Transporter } from "nodemailer";

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP 未配置：请在环境变量中设置 SMTP_HOST / SMTP_USER / SMTP_PASS"
    );
  }

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return cachedTransport;
}

function getFrom(): string {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@localhost";
}

const PURPOSE_SUBJECTS: Record<string, string> = {
  REGISTER: "【Seedance Studio】注册邮箱验证码",
  RESET_PASSWORD: "【Seedance Studio】重置密码验证码",
};

const PURPOSE_INTROS: Record<string, string> = {
  REGISTER: "您正在注册 Seedance Studio 账号。",
  RESET_PASSWORD: "您正在重置 Seedance Studio 账号密码。",
};

export async function sendVerificationCodeEmail(args: {
  to: string;
  code: string;
  purpose: "REGISTER" | "RESET_PASSWORD";
  expiresInMinutes: number;
}): Promise<void> {
  const { to, code, purpose, expiresInMinutes } = args;
  const subject = PURPOSE_SUBJECTS[purpose] ?? "【Seedance Studio】邮箱验证码";
  const intro = PURPOSE_INTROS[purpose] ?? "您正在执行邮箱验证操作。";

  const text = `${intro}\n\n验证码：${code}\n有效期：${expiresInMinutes} 分钟\n\n如果不是您本人的操作，请忽略本邮件。`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 16px;font-size:18px">Seedance Studio</h2>
      <p style="margin:0 0 12px;line-height:1.6">${intro}</p>
      <p style="margin:0 0 12px;line-height:1.6">您的验证码：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;padding:12px 16px;background:#f5f5f7;border-radius:6px;text-align:center">${code}</p>
      <p style="margin:0 0 12px;line-height:1.6;color:#666;font-size:13px">有效期 ${expiresInMinutes} 分钟。如果不是您本人的操作，请忽略本邮件。</p>
    </div>
  `;

  const transport = getTransport();
  await transport.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
    html,
  });
}
