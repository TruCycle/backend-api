Place email header assets in this folder using these exact file names:

- `logo.svg` (combined logo mark + TruCycle wordmark, transparent background recommended)
- `linkedin-icon.svg` (48x48 circular icon)
- `x-icon.svg` (48x48 circular icon)
- `instagram-icon.svg` (48x48 circular icon)
- `password-lock.svg` (lock icon for reset OTP email body)

How URLs are resolved in email templates:

- Base URL = `EMAIL_ASSETS_BASE_URL` if set
- Fallback base URL = `APP_BASE_URL`
- Final URLs used:
  - `/email-assets/logo.svg`
  - `/email-assets/linkedin-icon.svg`
  - `/email-assets/x-icon.svg`
  - `/email-assets/instagram-icon.svg`
  - `/email-assets/password-lock.svg`
