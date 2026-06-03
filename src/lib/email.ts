export interface SendOTPOptions {
  to: string;
  otp: string;
  brandName: string;
  resendApiKey: string;
  fromAddress?: string;
}

export async function sendOTPEmail({
  to,
  otp,
  brandName,
  resendApiKey,
  fromAddress = 'exchange@lakeandlocals.com',
}: SendOTPOptions): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${brandName} <${fromAddress}>`,
      to: [to],
      subject: `Your ${brandName} Exchange login code: ${otp}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f4f1ea;">
          <h2 style="color: #1e3320; margin: 0 0 8px;">${brandName} Exchange</h2>
          <p style="color: #507850; margin: 0 0 32px; font-size: 0.9rem;">Your sign-in code</p>

          <div style="background: #ffffff; border: 1px solid #ddd8cc; border-radius: 6px; padding: 32px; text-align: center; margin-bottom: 24px;">
            <p style="color: #777; font-size: 0.85rem; margin: 0 0 12px;">Enter this code to sign in</p>
            <div style="font-size: 2.5rem; font-weight: bold; color: #1e3320; letter-spacing: 8px;">${otp}</div>
            <p style="color: #777; font-size: 0.8rem; margin: 16px 0 0;">Expires in 10 minutes</p>
          </div>

          <p style="color: #777; font-size: 0.8rem; margin: 0;">
            If you didn't request this code, you can safely ignore this email.
            Someone may have entered your email address by mistake.
          </p>
        </div>
      `,
      text: `Your ${brandName} Exchange sign-in code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Resend error (${response.status}):`, error);
    throw new Error(`Email delivery failed (${response.status}): ${error}`);
  }
}
