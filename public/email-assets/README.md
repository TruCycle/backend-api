Place email header assets in this folder using these exact file names:

- `logo.png` (combined logo mark + TruCycle wordmark, transparent background recommended)
- `linkedin.png` (48x48 circular icon)
- `instagram.png` (48x48 circular icon)
- `password-lock.png` (lock icon for reset OTP email body)

How URLs are resolved in email templates:

- Base URL = `EMAIL_ASSETS_BASE_URL` if set
- Fallback base URL = `APP_BASE_URL`
- Final URLs used:
  - `/email-assets/logo.png`
  - `/email-assets/linkedin.png`
  - `/email-assets/instagram.png`
  - `/email-assets/password-lock.png`
