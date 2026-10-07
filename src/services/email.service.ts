// Transactional email through Brevo's HTTPS API (Render's free plan blocks
// SMTP ports, so no SMTP). Needs BREVO_API_KEY and EMAIL_FROM, a sender
// address verified in Brevo. Without a key (local development) emails are
// printed to the console instead, so the flows still work end to end.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export interface Email {
  to: { email: string; name?: string };
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email is not configured (BREVO_API_KEY, EMAIL_FROM)");
    }
    console.log(`[email] (not sent: no BREVO_API_KEY) To: ${email.to.email}\nSubject: ${email.subject}\n${email.text}`);
    return;
  }
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: process.env.EMAIL_FROM_NAME ?? "GroundTrust" },
      to: [email.to],
      subject: email.subject,
      textContent: email.text,
      htmlContent: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Brevo rejected the email: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A calm, single-column email in the app's style, readable without images.
export function emailLayout(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footnote?: string }) {
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2d3632">${escapeHtml(t)}</p>`;
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:#111715;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${escapeHtml(opts.button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#616b66">Or paste this link into your browser:<br><span style="word-break:break-all;color:#2f5d4f">${escapeHtml(opts.button.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f6f4;font-family:Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f4;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e1e5e1;border-radius:18px;padding:32px">
      <tr><td>
        <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#111715">GroundTrust</p>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111715">${escapeHtml(opts.heading)}</h1>
        ${opts.paragraphs.map(p).join("")}
        ${button}
        ${opts.footnote ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e1e5e1;font-size:12.5px;line-height:1.5;color:#616b66">${escapeHtml(opts.footnote)}</p>` : ""}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
