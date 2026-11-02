# Production: the site on Vercel, the API on one AWS server

```
Shoppers / admin ──▶ Vercel (Next.js site + admin, e.g. test.kachabiti.com; /api rewritten to NEST_URL)
                         │
                         ▼ https://<site_domain> (e.g. api-test.kachabiti.com; A record → the Elastic IP)
              EC2 t4g.small (ARM, Ubuntu 24.04, 2 GB + 2 GB swap)
               ├─ caddy (ports 80/443, HTTPS from Let's Encrypt) ──▶ api (NestJS, ghcr.io/<owner>/kachabity-api)
               └─ db (Postgres 17, hourly backups to S3, daily disk snapshots)
Product photos ──▶ S3 bucket kachabity-products-<id> (public read); documents and backups: private buckets
```

- **Infrastructure** (`infra/terraform/`): the instance and its role (read/write on the three buckets, so
  no S3 keys anywhere), its firewall (80, 443, SSH), the Elastic IP, the buckets, daily disk snapshots, a monthly budget
  alert and e-mail alarms (see Alerts). You run Terraform yourself; nothing is created without `apply`.
- **Server files** (`deploy/`): `docker-compose.prod.yml`, `deploy.sh` (backup → migrate → new API next
  to the old one → switch once healthy, see below), `backup.sh` (hourly to S3, 30 days kept).
- **CI/CD** (`.github/workflows/`): `ci.yml` checks pull requests and pushes to `main` (types, lint, API
  build, all end-to-end suites on an empty database built from `db/baseline.sql`). On `kachabiti-nest`,
  `deploy.yml` is the one run per push: CI, then, only if the API changed, the API image built on
  GitHub's ARM runners and `deploy.sh` on the server.

**Separate deploys.** A push deploys only the side it changes:
- The API deploys when the push changes `api/`, `supabase/migrations/`, `db/baseline.sql`, `deploy/`,
  the deploy workflow, or a `lib/` file the API imports (`.github/scripts/api-changed.mjs` asks
  TypeScript which ones, so the list keeps itself up to date).
- Vercel skips the site build when the push changes only `api/`, `supabase/`, `db/`, `deploy/`, `infra/`,
  `.github/`, `docs/` or Markdown files (`ignoreCommand` in `vercel.json`, compared with its last deploy).
- A change to a shared `lib/` file deploys both. A manual "Run workflow" always deploys the API.

**No downtime.** `deploy.sh` starts the new API container next to the running one; Caddy sends requests
to every running API container and retries on another when one refuses. The old container stops only
once the new one passes its health check (it finishes its requests in progress first). If the new one
never gets healthy, it is removed and the old one keeps serving. Migrations run while the old API still
serves, so write them to work with the previous code too: add a column first, remove the old one in a
later deploy.

## What it costs

Approximate on-demand prices in eu-north-1 (Stockholm), October 2026. Check the AWS Pricing Calculator.

| Item | Per month |
|---|---|
| EC2 t4g.small, 730 h × ~$0.017 | ~$12.40 |
| EBS gp3 30 GB × ~$0.084 | ~$2.50 |
| Public IPv4 address (the Elastic IP), $0.005/h | ~$3.65 |
| S3: a few GB of photos, documents, 30 days of backups, requests | < $0.50 |
| Disk snapshots, 7 daily (incremental: about the disk's used space, ~$0.05/GB) | ~$0.50–1 |
| Data out to the internet (first 100 GB a month free) | $0 |
| AWS Budgets (first two budgets free) | $0 |
| **Total on AWS** | **~$19** |

Plus Vercel for the site: Hobby is free but for non-commercial use; a shop taking orders belongs on Pro.

On the Free plan the $100 sign-up credit covers about 5 months. Launching an EC2 instance and setting up
a budget (both done by this Terraform) are two of the console's "Earn AWS credits" activities, $20
each, which covers the full 6 months. The Free plan ends after 6 months or when the credits run out,
whichever comes first. **Upgrade to the paid plan before then, or the account closes and the server
with its database goes.** After that it's about $19 a month (less with a 1-year Savings Plan).

The Free plan allows only some instance types (t3.micro, t3.small, t4g.micro, t4g.small, c7i-flex.large,
m7i-flex.large); t4g.small is the smallest with comfortable memory for the API and Postgres.

## One-time setup

### 1. AWS
1. Check your project's Region: AWS Settings → the project → Overview → Region (resources can only go
   there; `aws_region` in `terraform.tfvars`).
2. Sign in from the terminal and hand the short-lived keys to Terraform (redo this when they expire):
   ```bash
   aws login --profile <name>
   eval "$(aws configure export-credentials --profile <name> --format env)"
   ```
3. Create the bucket for Terraform's state once (any unique name, in your Region):
   ```bash
   aws s3api create-bucket --bucket kachabity-terraform-state-<something unique> --region <region> \
     --create-bucket-configuration LocationConstraint=<region>
   aws s3api put-bucket-versioning --bucket kachabity-terraform-state-<…> --versioning-configuration Status=Enabled
   ```

### 2. SSH keys
```bash
ssh-keygen -t ed25519 -f ~/.ssh/kachabity-deploy -N "" -C github-deploy
```
`kachabity-deploy.pub` goes in `deploy_ssh_public_key`; the private file becomes the GitHub secret
`DEPLOY_SSH_KEY`. Your own `~/.ssh/id_ed25519.pub` goes in `admin_ssh_public_key`.

### 3. Terraform
```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill it in
cp backend.hcl.example backend.hcl             # the state bucket and your Region
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```
Without Terraform installed: `docker run --rm -it -v "$PWD:/tf" -w /tf -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN hashicorp/terraform:1.10.5 <command>`

Afterwards: `terraform output server_public_ip` and `terraform output -raw server_env` (the S3 and domain
lines of the server `.env`). Wait for the first boot: `ssh ubuntu@<ip> cloud-init status --wait`.
AWS also e-mails `budget_email` a subscription link for the alarms: click it, or no alarm reaches you.

### 4. DNS
At your domain's DNS provider (Hostinger for kachabiti.com: hPanel → Domains → DNS records; not Vercel's
DNS page, and leave the nameservers alone), before the first deploy:
- **A** record for `site_domain` (e.g. `api-test`) → the server's IP. Caddy gets the HTTPS certificate as
  soon as the name points at it.
- **CNAME** for the site (e.g. `test`) → the value Vercel shows under the project's Settings → Domains.

### 5. GitHub
Settings → **Environments** → **production** (add yourself as a required reviewer if you want to approve
each deploy):
- Secrets:
  - `DEPLOY_HOST` = the IP, `DEPLOY_SSH_KEY` = the private deploy key, `DEPLOY_KNOWN_HOSTS` = the output
    of `ssh-keyscan -t ed25519 <ip>`.
  - `PROD_ENV` = the whole server `.env` (template: `deploy/.env.example`; `POSTGRES_PASSWORD` letters
    and digits only; the S3 and domain lines from `terraform output -raw server_env`; `NEXT_URL` = the
    Vercel site, for the cache refresh).
- Variable: `API_URL` = `https://<site_domain>` (the deploy checks it answers).
- Set these before the first push of `kachabiti-nest`: the deploy runs as soon as the API changes.

### 6. Vercel
Import the repo, Production Branch `kachabiti-nest`, and in Settings → Environment Variables (Production):
`NEST_URL=https://<site_domain>`, `FILES_PUBLIC_URL` (from `server_env`), the **same** `AUTH_SECRET` and
`REVALIDATE_SECRET` as `PROD_ENV`, `ENV=production`, `NEXT_PUBLIC_SITE_URL` (the site's address), and the
Sentry and other `NEXT_PUBLIC_*` values (see `ENV-EXAMPLE.md`). Then Settings → Domains → add the site's
name. Redeploy once the API answers, so the pages are built with real data.

### 7. First deploy and the data
1. Actions → **Deploy** → Run workflow. On the empty server, `migrate.mjs` loads `db/baseline.sql`.
2. Move the shop's data from Supabase as in `docs/MIGRATION-NESTJS.md` (phase 5 runbook). The target
   database is reached through an SSH tunnel:
   `ssh -N -L 15432:127.0.0.1:5432 ubuntu@<ip>` then
   `TARGET_DATABASE_URL=postgresql://kachabity:<password>@host.docker.internal:15432/kachabity node scripts/db/move-database.mjs --replace`.
   The same tunnel works for pgAdmin (host `localhost`, port `15432`).
3. Copy the files with `api/scripts/copy-storage.mjs --rewrite` (from `api/`), with the `server_env`
   values, your exported keys as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_SESSION_TOKEN`, and
   `DATABASE_URL` through the tunnel.

## Everyday

- **Deploy:** merge or push to `kachabiti-nest`. CI must pass; the API deploys if it changed, and Vercel
  builds the site if it changed (see "Separate deploys").
- **Roll back the API:** Actions → Deploy → Run workflow on an older commit, or on the server
  `cd /opt/kachabity && ./deploy.sh ghcr.io/<owner>/kachabity-api:<older-sha>`.
  A new API that isn't healthy is removed and the old one keeps serving. Migrations are not undone:
  restore a backup for that.
- **Logs and status:** `ssh deploy@<ip>` then `cd /opt/kachabity && docker compose -f docker-compose.prod.yml ps`
  (or `logs -f api`, `logs -f caddy`).
- **New migration:** add the file to `supabase/migrations/`; the next deploy applies it after a backup.
- **Costs:** Billing and Cost Management → Cost Explorer; the budget e-mails you at 80% of
  `monthly_budget_usd`.
- **Stop paying for a test:** `terraform destroy` removes everything except the state bucket (empty the
  three buckets first; S3 refuses to delete a bucket with files in it). The instance has termination
  protection: set `disable_api_termination = false` in `aws.tf` and `terraform apply` first.

## Backups

Two kinds, both automatic:
- **Database dumps:** every hour at :30 (cron in `cloud-init.yaml`) and before every deploy that has a
  previous version, `backup.sh` dumps the database into the private bucket `kachabity-backups-<id>` (30 days
  kept; 2 days on the server too), so at most an hour of data is lost. Use them to restore the database
  alone, on this server or another. A server created before the hourly schedule still has the nightly
  cron line (cloud-init only runs at first boot); replace it once:
  ```bash
  ssh ubuntu@<ip> "echo '30 * * * * deploy flock -n /tmp/kachabity-backup.lock /opt/kachabity/backup.sh >> /var/log/kachabity-backup.log 2>&1' | sudo tee /etc/cron.d/kachabity-backup"
  ```
- **Disk snapshots:** every day at 01:00 UTC, AWS snapshots the server's whole disk (Postgres included;
  Data Lifecycle Manager, `aws_dlm_lifecycle_policy.server`), keeping the last `snapshot_days` (7). Use them
  when the server itself is lost or broken: EC2 → Snapshots → the snapshot → Create volume (same
  availability zone), stop the instance, detach its root volume, attach the new one as `/dev/sda1`, start.
  Postgres starts from it as after a power cut (it replays its log), so a snapshot is consistent.

Restore into an empty database:
```bash
pg_restore --clean --if-exists --no-owner -d postgresql://… kachabity-<date>.dump
```
(create the extensions first on a brand-new database: `pgcrypto`, `pg_trgm`, `unaccent`, `uuid-ossp` in
schema `extensions`; `api/scripts/migrate.mjs` shows the statements).

## Alerts

E-mails to `budget_email` through the SNS topic `kachabity-alerts` (confirm its subscription e-mail once),
both when something breaks and when it is OK again:
- **kachabity-backup-missing:** no backup reached S3 for 2 hours. Each successful `backup.sh` sends the
  metric `Kachabity/BackupSucceeded`; look at `/var/log/kachabity-backup.log` (a full disk, Docker down, S3
  refused). Right after the first `apply` it fires until the first hourly backup with the new script runs.
- **kachabity-server-system-check:** an AWS hardware or network fault; EC2 recovers the instance onto
  healthy hardware (same disk, IP and data).
- **kachabity-server-instance-check:** the server stopped answering (out of memory, hung); EC2 reboots it.
  Postgres recovers from its log as after a power cut.

The instance also has termination protection, so it can't be terminated by mistake (see Stop paying).

## When kachabiti-nest is merged into main

Change `branches: [kachabiti-nest]` in `.github/workflows/deploy.yml` to `main`.
