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

function getEmailAssetsBaseUrl(): string {
  const base = process.env.EMAIL_ASSETS_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

function buildAssetUrl(path: string): string {
  return `${getEmailAssetsBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildBrandedEmailLayout({ bodyHtml }: BrandedEmailLayoutParams): string {
  const logoUrl = escapeHtml(buildAssetUrl('/email-assets/logo.svg'));
  const linkedinIconUrl = escapeHtml(buildAssetUrl('/email-assets/linkedin-icon.svg'));
  const xIconUrl = escapeHtml(buildAssetUrl('/email-assets/x-icon.svg'));
  const instagramIconUrl = escapeHtml(buildAssetUrl('/email-assets/instagram-icon.svg'));

  return `
    <div style="margin:0;padding:0;background:#e5e7eb;font-family:Arial,sans-serif;color:#232528">
      <div style="max-width:1200px;margin:0 auto;padding:28px 20px 40px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 28px">
          <div style="display:flex;align-items:center">
            <img src="${logoUrl}" alt="TruCycle" style="display:block;width:260px;max-width:100%;height:auto" />
          </div>
          <div style="font-size:0;line-height:0;white-space:nowrap">
            <img src="${linkedinIconUrl}" alt="LinkedIn" style="display:inline-block;width:42px;height:42px;margin-left:12px" />
            <img src="${xIconUrl}" alt="X" style="display:inline-block;width:42px;height:42px;margin-left:12px" />
            <img src="${instagramIconUrl}" alt="Instagram" style="display:inline-block;width:42px;height:42px;margin-left:12px" />
          </div>
        </div>
        <div style="background:#f3f4f6;padding:54px 86px">${bodyHtml}</div>
      </div>
    </div>
  `;
}

export function buildPasswordResetOtpEmailTemplate({
  firstName,
  otp,
  expiresInMinutes,
  supportEmail,
}: PasswordResetOtpTemplateParams): string {
  const passwordLockIconUrl = escapeHtml(buildAssetUrl('/email-assets/password-lock.svg'));
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeSupportEmail = escapeHtml(supportEmail || 'support@proposalai.com');
  const otpBoxes = otp
    .split('')
    .map(
      (digit) =>
        `<span style="display:inline-block;width:110px;height:110px;line-height:110px;margin:0 16px 10px 0;border:2px solid #2d2d2d;border-radius:14px;font-size:74px;font-weight:700;text-align:center;color:#222;box-sizing:border-box">${escapeHtml(digit)}</span>`,
    )
    .join('');

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 38px"><img src="${passwordLockIconUrl}" alt="Password reset" style="display:block;width:84px;height:84px" /></p>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35">Hi${safeName ? ` ${safeName}` : ''},</p>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35">Here's your one-time reset code:</p>
      <div style="margin:0 0 34px">${otpBoxes}</div>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35">This code will only be valid for the next ${expiresInMinutes} minute(s).</p>
      <p style="margin:0 0 78px;font-size:50px;line-height:1.35">
        If you didn't request this password reset, please contact our support team immediately at
        <a href="mailto:${safeSupportEmail}" style="color:#8be28f;text-decoration:none">${safeSupportEmail}</a>
      </p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildVerifyEmailTemplate({ firstName, verifyUrl }: VerifyEmailTemplateParams): string {
  const passwordLockIconUrl = escapeHtml(buildAssetUrl('/email-assets/password-lock.svg'));
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeVerifyUrl = escapeHtml(verifyUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 38px"><img src="${passwordLockIconUrl}" alt="Verify email" style="display:block;width:84px;height:84px" /></p>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35">Hi${safeName ? ` ${safeName}` : ''},</p>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35">Please verify your email by clicking the button below:</p>
      <p style="margin:0 0 40px">
        <a href="${safeVerifyUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:22px 34px;border-radius:18px;font-size:50px;line-height:1.2;font-weight:700">Verify Email</a>
      </p>
      <p style="margin:0 0 130px;font-size:50px;line-height:1.35">
        This code will only be valid for the next 24 hours.<br />
        If you didn't request this, you can ignore this email
      </p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildWelcomeEmailTemplate({ firstName }: WelcomeEmailTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 34px;font-size:58px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 48px;font-size:50px;line-height:1.35;color:#232528">Welcome to TruCycle - we're excited to have you on board! &#128640;</p>
      <p style="margin:0 0 36px;font-size:50px;line-height:1.35;color:#232528">Here are the next steps:</p>
      <p style="margin:0 0 30px;font-size:50px;line-height:1.35;color:#232528">&#9989; <strong>List your first item</strong> - Share items you no longer need</p>
      <p style="margin:0 0 30px;font-size:50px;line-height:1.35;color:#232528">&#9989; <strong>Browse nearby items</strong> - Discover nearby items</p>
      <p style="margin:0 0 50px;font-size:50px;line-height:1.35;color:#232528">&#9989; <strong>Earn your first reward</strong> - Complete a verified exchange for $10</p>
      <p style="margin:0 0 90px;font-size:58px;line-height:1.25;color:#232528">Need help?</p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
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
      <p style="margin:0 0 34px;font-size:58px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 34px;font-size:50px;line-height:1.35;color:#232528">Your password has been reset. You're all set to dive back in and explore your account.</p>
      <p style="margin:0 0 44px;font-size:50px;line-height:1.35;color:#232528">
        For more information or assistance, send an email to<br />
        <a href="mailto:${safeSupportEmail}" style="color:#8be28f;text-decoration:none">${safeSupportEmail}</a>
      </p>
      <p style="margin:0 0 120px">
        <a href="${safeLoginUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:22px 66px;border-radius:18px;font-size:50px;line-height:1.2;font-weight:700">Login</a>
      </p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}

export function buildFeedbackEmailTemplate({ firstName, feedbackUrl }: FeedbackEmailTemplateParams): string {
  const safeName = firstName ? escapeHtml(firstName) : '';
  const safeFeedbackUrl = escapeHtml(feedbackUrl);

  return buildBrandedEmailLayout({
    bodyHtml: `
      <p style="margin:0 0 34px;font-size:58px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 42px;font-size:50px;line-height:1.35;color:#232528">Thanks for using TruCycle! We're always improving and would love to hear your thoughts.</p>
      <p style="margin:0 0 46px">
        <a href="${safeFeedbackUrl}" target="_blank" style="display:inline-block;background:#8be28f;color:#1d2330;text-decoration:none;padding:22px 40px;border-radius:18px;font-size:50px;line-height:1.2;font-weight:700">Share Feedback</a>
      </p>
      <p style="margin:0 0 90px;font-size:50px;line-height:1.35;color:#232528">Your input helps us build the best experience for you and your community.</p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
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
      <p style="margin:0 0 34px;font-size:58px;line-height:1.2;font-weight:700;color:#1f2328">Hi${safeName ? ` ${safeName}` : ''}, &#128075;</p>
      <p style="margin:0 0 44px;font-size:50px;line-height:1.35;color:#232528">
        Two-Factor Authentication (2FA) has been successfully enabled on your account.<br />
        From now on, you'll need a verification code to sign in.
      </p>
      <p style="margin:0 0 110px;font-size:50px;line-height:1.35;color:#232528">
        If this wasn't you, please
        <a href="${safeResetPasswordUrl}" target="_blank" style="color:#232528;text-decoration:underline">reset your password</a>
        immediately or contact support.
      </p>
      <p style="margin:0;font-size:50px;line-height:1.35;color:#64748b">Best,<br />TruCycle Team</p>
    `,
  });
}
