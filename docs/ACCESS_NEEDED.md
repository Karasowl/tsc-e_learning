# Access State

Public pages only expose the WordPress/LoginPress login, so the platform cannot be fully inventoried by public crawling.

## Current Access

SSH/SFTP access is usable for read-only extraction. The shared-hosting account authenticates over SFTP, but a normal remote shell channel may not be available in this environment, so extraction can use SFTP plus temporary, token-protected PHP probes when needed.

Already extracted locally:

- `tmp/wordpress.sql.gz`
- `tmp/wordpress.sql`
- `tmp/wp-audit.json`
- `tmp/wp-users.json`
- `tmp/wp-catalog.json`

The temporary remote PHP dump script and temporary remote SQL dump were deleted after download.

Still useful to extract next:

- `wp-content/uploads`
- `wp-content/plugins`
- Active theme folder
- Tutor/GamiPress/LoginPress/WP Mail SMTP settings and snippets related to certificates, pass/fail email notifications, and custom dashboards.

## Audit Commands

With the local SQL dump:

```powershell
pnpm wp:audit -- --dump C:\path\to\wordpress.sql --out tmp\wp-audit.json
pnpm wp:export-users -- --dump C:\path\to\wordpress.sql --out tmp\wp-users.json
pnpm wp:export-catalog -- --dump C:\path\to\wordpress.sql --out tmp\wp-catalog.json
```

Expected outputs:

- `tmp/wp-audit.json`: plugin/table/post-type evidence.
- `tmp/wp-users.json`: users, roles, and legacy password hashes. Sensitive; do not share publicly.
- `tmp/wp-catalog.json`: courses, lessons, quizzes, question types, curriculum sections, progress records, and feature evidence.

These files tell us what functions are actually used before we implement deeper LMS behavior.

## Acceptable Alternatives

- Temporary SFTP/SSH access to a staging clone.
- Hostinger backup download link.
- WordPress admin access plus phpMyAdmin/export access.
- Hostinger API token for read-only discovery. This can identify hosting accounts, websites, and subdomains, but may still need SFTP/hPanel backup for files and SQL.

## Hostinger API Reality Check

The Hostinger API token is useful, but it is not enough by itself for this LMS migration on shared hosting.

Confirmed API use:

- List hosting websites.
- List subdomains and, when returned, their root directories.
- List domains.
- List VPS machines and VPS backups if the site runs on VPS.

Not exposed in the public OpenAPI for shared hosting:

- Download `wordpress.sql`.
- Download `wp-content/uploads`.
- Download `wp-content/plugins`.
- Download the active theme folder.

So the correct flow is:

1. Use Hostinger API token for discovery.
2. Use SSH/SFTP, hPanel backup, or phpMyAdmin/WP-CLI for extraction.

Run discovery:

```powershell
$env:HOSTINGER_API_TOKEN="temporary-token"
pnpm hostinger:discover -- --domain tscseguridadprivada.com.mx --out tmp\hostinger-discovery.json
Remove-Item Env:\HOSTINGER_API_TOKEN
```

Optional: override the API base URL only if Hostinger documentation changes:

```powershell
$env:HOSTINGER_API_BASE_URL="https://developers.hostinger.com"
```

## SSH/WP-CLI Extraction

If hPanel SSH is available, this is the cleanest read-only extraction path. Hostinger shared hosting commonly uses port `65002`.

```bash
ssh -p 65002 uXXXXXXXXX@HOST_FROM_HPANEL
find ~/domains -name wp-config.php
cd PATH_TO_CAPACITA_WORDPRESS

wp core version
wp plugin list --format=json > plugins.json
wp theme list --format=json > themes.json
wp db export wordpress.sql
tar -czf uploads.tgz wp-content/uploads
tar -czf plugins.tgz wp-content/plugins
ACTIVE_THEME="$(wp theme list --status=active --field=name)"
tar -czf theme.tgz "wp-content/themes/$ACTIVE_THEME"
```

Download from your machine:

```powershell
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/wordpress.sql tmp\
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/uploads.tgz tmp\
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/plugins.tgz tmp\
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/theme.tgz tmp\
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/plugins.json tmp\
scp -P 65002 uXXXXXXXXX@HOST_FROM_HPANEL:/path/to/capacita/themes.json tmp\
```

If WP-CLI is unavailable, read `wp-config.php` for `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST`, then export with `mysqldump` or use hPanel phpMyAdmin.

If shell commands are unavailable but SFTP works, use SFTP to upload a temporary token-protected PHP exporter into the WordPress root, write the dump under `wp-content/uploads`, download it, and then delete both remote temporary files immediately.

## Do Not Put In Git

- Hostinger tokens.
- WordPress admin passwords.
- Database passwords.
- SMTP passwords.
- SQL dumps or user data.

Put secrets in `.env` only, or provide them interactively when needed.
