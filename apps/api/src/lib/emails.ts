import type { Email } from "./mailer.ts";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function layout({ heading, body, action, url, footer }: { heading: string; body: string; action: string; url: string; footer: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2330">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ee;border-radius:12px">
<tr><td style="padding:28px">
<p style="margin:0 0 20px;font-weight:600;font-size:16px">Fleqo</p>
<h1 style="margin:0 0 12px;font-size:20px">${heading}</h1>
<p style="margin:0 0 20px;line-height:1.5">${body}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#3846b1;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${action}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6070;line-height:1.5">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6070;line-height:1.5">${footer}</p>
</td></tr></table>
</body></html>`;
}

export function verificationEmail(user: { name: string; email: string }, url: string): Email {
  const name = user.name.trim() || "there";
  return {
    to: user.email,
    subject: "Verify your email for Fleqo",
    text: `Hi ${name},\n\nConfirm your email address to finish setting up your Fleqo account:\n${url}\n\nThe link expires in 24 hours. If you did not create a Fleqo account, ignore this email.`,
    html: layout({
      heading: "Verify your email",
      body: `Hi ${escapeHtml(name)}, confirm your email address to finish setting up your Fleqo account.`,
      action: "Verify email",
      url,
      footer: "The link expires in 24 hours. If you did not create a Fleqo account, you can ignore this email.",
    }),
  };
}

export function passwordResetEmail(user: { name: string; email: string }, url: string): Email {
  const name = user.name.trim() || "there";
  return {
    to: user.email,
    subject: "Reset your Fleqo password",
    text: `Hi ${name},\n\nUse this link to choose a new Fleqo password:\n${url}\n\nThe link expires in 1 hour and works once. Signing in with the new password signs you out everywhere else. If you did not ask for this, ignore this email; your password stays the same.`,
    html: layout({
      heading: "Reset your password",
      body: `Hi ${escapeHtml(name)}, use the button below to choose a new Fleqo password. You will be signed out of your other sessions.`,
      action: "Choose a new password",
      url,
      footer: "The link expires in 1 hour and works once. If you did not ask for this, ignore this email; your password stays the same.",
    }),
  };
}

export function existingAccountEmail(user: { name: string; email: string }, signInUrl: string): Email {
  const name = user.name.trim() || "there";
  return {
    to: user.email,
    subject: "Someone tried to create a Fleqo account with your email",
    text: `Hi ${name},\n\nSomeone tried to sign up for Fleqo with this email address, which already has an account. If it was you, sign in instead: ${signInUrl}\nForgot your password? Use "Forgot password?" on the sign-in page.\n\nIf it was not you, no action is needed; nothing was changed.`,
    html: layout({
      heading: "You already have an account",
      body: `Hi ${escapeHtml(name)}, someone tried to sign up for Fleqo with this email address, which already has an account. If it was you, sign in instead. If it was not you, no action is needed; nothing was changed.`,
      action: "Sign in",
      url: signInUrl,
      footer: 'Forgot your password? Use "Forgot password?" on the sign-in page.',
    }),
  };
}
