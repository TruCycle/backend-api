Place email header assets in this folder using these exact file names:

- `logo.svg` (combined logo mark + TruCycle wordmark, transparent background recommended)
- `linkedin.svg` (48x48 circular icon, dark background with white logo)
- `twitter.svg` (48x48 circular icon, dark background with white X/Twitter logo)
- `instagram.svg` (48x48 circular icon, dark background with white logo)
- `password-lock.svg` (lock icon for reset OTP email body)

How URLs are resolved in email templates:

- Base URL = `EMAIL_ASSETS_BASE_URL` if set
- Fallback base URL = `APP_BASE_URL`
- Final URLs used:
  - `/email-assets/logo.svg`
  - `/email-assets/linkedin.svg`
  - `/email-assets/twitter.svg` 
  - `/email-assets/instagram.svg`
  - `/email-assets/password-lock.svg`
