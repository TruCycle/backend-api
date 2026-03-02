interface BrandedEmailLayoutParams {
  bodyHtml: string;
}

interface PasswordResetOtpTemplateParams {
  firstName?: string | null;
  otp: string;
  expiresInMinutes: number;
  supportEmail?: string;
}

interface VerifyEmailTemplateParams {
  firstName?: string | null;
  verifyUrl: string;
}

interface WelcomeEmailTemplateParams {
  firstName?: string | null;
}

interface PasswordResetSuccessTemplateParams {
  firstName?: string | null;
  supportEmail?: string;
  loginUrl: string;
}

interface FeedbackEmailTemplateParams {
  firstName?: string | null;
  feedbackUrl: string;
}

interface TwoFactorEnabledEmailTemplateParams {
  firstName?: string | null;
  resetPasswordUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INLINE_ASSET_CID = {
  logo: 'trucycle-logo',
  linkedin: 'trucycle-linkedin',
  twitter: 'trucycle-twitter-icon',
  instagram: 'trucycle-instagram',
  passwordLock: 'trucycle-password-lock',
} as const;
const PASSWORD_LOCK_ICON_STYLE = 'display:block;width:52px;height:52px';

export function buildBrandedEmailLayout({ bodyHtml }: BrandedEmailLayoutParams): string {
  const logoUrl = escapeHtml(`cid:${INLINE_ASSET_CID.logo}`);
  const linkedinIconUrl = escapeHtml(`cid:${INLINE_ASSET_CID.linkedin}`);
  const twitterIconUrl = escapeHtml(`cid:${INLINE_ASSET_CID.twitter}`);
  const instagramIconUrl = escapeHtml(`cid:${INLINE_ASSET_CID.instagram}`);
  const socialIconSize = 24;
  const socialIconStyle =
    'display:inline-block;width:24px;height:24px;margin-left:10px;vertical-align:middle';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @media only screen and (max-width: 480px) {
      .email-outer  { padding: 16px 8px 24px !important; }
      .email-card   { padding: 16px 12px 24px !important; }
      .email-body   { padding: 20px 16px !important; }
      .header-logo  { width: 110px !important; }
      .header-td-logo, .header-td-icons { display: block !important; width: 100% !important; }
      .otp-digit    { width: 36px !important; height: 44px !important; line-height: 44px !important; font-size: 22px !important; margin: 0 4px 8px 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Arial,sans-serif;color:#232528">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px 40px" class="email-outer">
    <div style="background:#F8FAFC;padding:24px 28px 32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05)" class="email-card">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:0 0 24px">
        <tr>
          <td valign="middle" align="left" style="padding:0" class="header-td-logo">
            <img src="${logoUrl}" alt="TruCycle" style="display:block;width:150px;max-width:100%;height:auto" class="header-logo" />
          </td>
          <td valign="middle" align="right" style="padding:0;white-space:nowrap;font-size:0;line-height:0" class="header-td-icons">
            <img src="${linkedinIconUrl}" alt="LinkedIn" width="${socialIconSize}" height="${socialIconSize}" style="${socialIconStyle}" />
            <img src="${twitterIconUrl}" alt="Twitter" width="${socialIconSize}" height="${socialIconSize}" style="${socialIconStyle}" />
            <img src="${instagramIconUrl}" alt="Instagram" width="${socialIconSize}" height="${socialIconSize}" style="${socialIconStyle}" />
          </td>
        </tr>
      </table>
      <div style="background:#ffffff;padding:32px 40px;border-radius:10px;color:#1f2328" class="email-body">${bodyHtml}</div>
    </div>
  </div>
</body>
</html>`;
}

export function buildPasswordResetOtpEmailTemplate({
  firstName,
  otp,
  expiresInMinutes,
  supportEmail,
}: PasswordResetOtpTemplateParams): string {
  const passwordLockIconUrl = escapeHtml(`cid:${INLINE_ASSET_CID.passwordLock}`);
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeSupportEmail = escapeHtml(supportEmail || 'support@proposalai.com');
  const otpBoxes = otp
    .split('')
    .map(
      (digit) =>
        `<span class="otp-digit" style="display:inline-block;width:48px;height:56px;line-height:56px;margin:0 8px 10px 0;border:1px solid #d1d5db;border-radius:8px;font-size:32px;font-weight:700;text-align:center;color:#222;box-sizing:border-box">${escapeHtml(digit)}</span>`,
    )
    .join('');

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 24px"><img src="${passwordLockIconUrl}" alt="Password reset" style="${PASSWORD_LOCK_ICON_STYLE}" /></p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">Hi${safeName ? ` ${safeName}` : ''},</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">Here's your one-time reset code:</p>
      <div style="margin:0 0 24px">${otpBoxes}</div>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">This code will only be valid for the next ${expiresInMinutes} minute(s).</p>
      <p style="margin:0 0 32px;font-size:14px;line-height:1.5;color:#475569">
        If you didn't request this password reset, please contact our support team immediately at
        <a href="mailto:${safeSupportEmail}" style="color:#22c55e;text-decoration:none">${safeSupportEmail}</a>
      </p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildVerifyEmailTemplate({ firstName, verifyUrl }: VerifyEmailTemplateParams): string {
  const passwordLockIconUrl = escapeHtml(`cid:${INLINE_ASSET_CID.passwordLock}`);
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeVerifyUrl = escapeHtml(verifyUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 24px"><img src="${passwordLockIconUrl}" alt="Verify email" style="${PASSWORD_LOCK_ICON_STYLE}" /></p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">Hi${safeName ? ` ${safeName}` : ''},</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">Please verify your email by clicking the button below:</p>
      <p style="margin:0 0 32px">
        <a href="${safeVerifyUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px;line-height:1.2;font-weight:600">Verify Email</a>
      </p>
      <p style="margin:0 0 40px;font-size:14px;line-height:1.5;color:#475569">
        This link will only be valid for the next 24 hours.<br />
        If you didn't request this, you can ignore this email.
      </p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildWelcomeEmailTemplate({ firstName }: WelcomeEmailTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:20px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#232528">Welcome to TruCycle - we're excited to have you on board! &#128640;</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#232528">Here are the next steps:</p>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#232528">&#9989; <strong>List your first item</strong> - Share items you no longer need</p>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#232528">&#9989; <strong>Browse nearby items</strong> - Discover nearby items</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#232528">&#9989; <strong>Earn your first reward</strong> - Complete a verified exchange for $10</p>
      <p style="margin:0 0 40px;font-size:16px;line-height:1.5;color:#475569">Need help? Reach out to our support team.</p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildPasswordResetSuccessEmailTemplate({
  firstName,
  supportEmail,
  loginUrl,
}: PasswordResetSuccessTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeSupportEmail = escapeHtml(supportEmail || 'support@proposalai.com');
  const safeLoginUrl = escapeHtml(loginUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:20px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#232528">Your password has been reset. You're all set to dive back in and explore your account.</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#232528">
        For more information or assistance, send an email to<br />
        <a href="mailto:${safeSupportEmail}" style="color:#22c55e;text-decoration:none">${safeSupportEmail}</a>
      </p>
      <p style="margin:0 0 40px">
        <a href="${safeLoginUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:16px;line-height:1.2;font-weight:600">Login</a>
      </p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildFeedbackEmailTemplate({ firstName, feedbackUrl }: FeedbackEmailTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeFeedbackUrl = escapeHtml(feedbackUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:20px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#232528">Thanks for using TruCycle! We're always improving and would love to hear your thoughts.</p>
      <p style="margin:0 0 24px">
        <a href="${safeFeedbackUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px;line-height:1.2;font-weight:600">Share Feedback</a>
      </p>
      <p style="margin:0 0 40px;font-size:16px;line-height:1.5;color:#475569">Your input helps us build the best experience for you and your community.</p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildTwoFactorEnabledEmailTemplate({
  firstName,
  resetPasswordUrl,
}: TwoFactorEnabledEmailTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeResetPasswordUrl = escapeHtml(resetPasswordUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:20px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#232528">
        Two-Factor Authentication (2FA) has been successfully enabled on your account.<br />
        From now on, you'll need a verification code to sign in.
      </p>
      <p style="margin:0 0 40px;font-size:14px;line-height:1.5;color:#475569">
        If this wasn't you, please
        <a href="${safeResetPasswordUrl}" target="_blank" style="color:#232528;text-decoration:underline">reset your password</a>
        immediately or contact support.
      </p>
      <p style="margin:0;font-size:16px;line-height:1.5;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}
