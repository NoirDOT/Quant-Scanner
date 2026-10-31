// /home/z/my-project/src/lib/scanner/alerts/email.ts
import nodemailer from "nodemailer";
import type { ScanSignal } from "../types";

let transporter: any = null; // use any to avoid @types/nodemailer dep

export function initEmail(config: {
  host: string;
  port: number;
  user: string;
  password: string;
}) {
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!transporter) throw new Error("Email transporter not initialized");
  await transporter.sendMail({
    from: `"Trading Scanner" <${(transporter.options as any).auth.user}>`,
    to,
    subject,
    html,
  });
}

export function signalToEmailHtml(s: ScanSignal): string {
  return `
  <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
    <h2 style="margin: 0 0 8px 0; color: #1e293b;">${s.strategyLabel}</h2>
    <p style="margin: 0 0 12px 0; color: #64748b; font-size: 14px;">
      ${s.symbol} · ${s.timeframe.toUpperCase()} · ${s.assetClass}
    </p>
    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div style="background: ${s.direction === "long" ? "#dcfce7" : s.direction === "short" ? "#fee2e2" : "#f1f5f9"}; color: ${s.direction === "long" ? "#166534" : s.direction === "short" ? "#991b1b" : "#475569"}; padding: 6px 14px; border-radius: 8px; font-weight: 600;">
        ${s.direction.toUpperCase()}
      </div>
      <div style="background: #f1f5f9; padding: 6px 14px; border-radius: 8px; font-weight: 600; color: #475569;">
        Score: ${s.score.toFixed(0)}/100
      </div>
    </div>
    ${s.entryPrice || s.stopPrice || s.targetPrice ? `
    <table style="width: 100%; margin-bottom: 16px; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="padding: 6px 0; color: #64748b;">Entry</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${s.entryPrice ?? "—"}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748b;">Stop</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #991b1b;">${s.stopPrice ?? "—"}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748b;">Target</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #166534;">${s.targetPrice ?? "—"}</td>
      </tr>
    </table>
    ` : ""}
    <h4 style="margin: 0 0 8px 0; color: #1e293b;">Triggered conditions</h4>
    <ul style="margin: 0; padding-left: 20px; color: #475569;">
      ${s.reasons.map((r) => `<li style="margin-bottom: 4px;">${r}</li>`).join("")}
    </ul>
  </div>
  `;
}
