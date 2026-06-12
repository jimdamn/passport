export interface SendClaimEmailOptions {
  to: string;
  claimCode: string;
  prizeName: string;
  brandName: string;
  loginUrl: string;
  resendApiKey: string;
  fromAddress?: string;
}

/**
 * Emails a guest their passport claim code after they register contact info.
 * Sent directly via Resend — KKAuth has no claim-email endpoint.
 */
export async function sendClaimEmail({
  to,
  claimCode,
  prizeName,
  brandName,
  loginUrl,
  resendApiKey,
  fromAddress = 'passport@lakeandlocals.com',
}: SendClaimEmailOptions): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${brandName} <${fromAddress}>`,
      to: [to],
      subject: `Your ${brandName} Passport reward is waiting — claim code inside`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f4f1ea;">
          <h2 style="color: #1e3320; margin: 0 0 8px;">${brandName} Passport</h2>
          <p style="color: #507850; margin: 0 0 32px; font-size: 0.9rem;">You won a reward!</p>

          <div style="background: #ffffff; border: 1px solid #ddd8cc; border-radius: 6px; padding: 32px; text-align: center; margin-bottom: 24px;">
            <p style="color: #777; font-size: 0.85rem; margin: 0 0 8px;">Your prize</p>
            <p style="font-size: 1.15rem; font-weight: bold; color: #1e3320; margin: 0 0 20px;">${prizeName}</p>
            <p style="color: #777; font-size: 0.85rem; margin: 0 0 12px;">Your claim code</p>
            <div style="font-size: 1.8rem; font-weight: bold; color: #1e3320; letter-spacing: 4px; font-family: monospace;">${claimCode}</div>
            <p style="color: #777; font-size: 0.8rem; margin: 16px 0 0;">This code expires in 7 days</p>
          </div>

          <p style="color: #555; font-size: 0.88rem; line-height: 1.5; margin: 0 0 20px;">
            Keep this code safe — it's your proof of the win. Sign in (or create your
            free account) and have your claim code ready to deposit your reward.
          </p>

          <a href="${loginUrl}"
             style="display: inline-block; background: #1e3320; color: #f4f1ea; font-family: system-ui, sans-serif; font-size: 0.92rem; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
            Sign In to ${brandName} →
          </a>

          <p style="color: #999; font-size: 0.78rem; margin: 28px 0 0;">
            If you didn't scan a ${brandName} Passport QR code, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `You won: ${prizeName}\n\nYour ${brandName} Passport claim code: ${claimCode}\n\nThis code expires in 7 days. Sign in at ${loginUrl} and have your claim code ready to deposit your reward.\n\nIf you didn't scan a ${brandName} Passport QR code, ignore this email.`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Resend error (${response.status}):`, error);
    throw new Error(`Email delivery failed (${response.status}): ${error}`);
  }
}
