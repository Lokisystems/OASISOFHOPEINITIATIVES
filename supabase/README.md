# Supabase Configuration Guide

To implement the "Oasis of Hope" premium email templates in your Supabase project, follow these steps:

## 📧 Email Templates

### 1. Email Confirmation
Paste the content of [email-confirmation.html](file:///d:/LOKI/stitch_oasis_of_hope_home/supabase/templates/email-confirmation.html) into:
**Supabase Dashboard > Authentication > Email Templates > Confirm signup**

### 🔐 Auth Settings
Make sure the following is enabled in **Supabase Dashboard > Authentication > Providers > Email**:
- **Confirm Email**: `ON` (Required for the confirmation link to be sent)
- **Secure Email Change**: `ON` (Recommended)

### 🛠️ Important Notes
- **Redirect URL**: Ensure your site URL is added to the "Additional Redirect URLs" in Supabase Auth settings if you are testing on multiple domains.
- **Logo URL**: The template uses a logo hosted in your Supabase storage. Ensure you have a bucket named `assets` with a `logo.png` file or update the URL in the template.
