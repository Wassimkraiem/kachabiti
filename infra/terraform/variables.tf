variable "aws_region" {
  type        = string
  description = "Your project's Region (AWS Settings → the project → Overview → Region); resources can't go elsewhere."
}

# The machine: Graviton (ARM), like the images CI builds. t4g.small = 2 cores, 2 GB of memory, and
# among the types the Free plan allows.
variable "instance_type" {
  type    = string
  default = "t4g.small"
}
variable "disk_gb" {
  type    = number
  default = 30
}
variable "snapshot_days" {
  type        = number
  default     = 7
  description = "How many daily snapshots of the server's disk are kept."
}

# Cost alarm: an e-mail at 80% of this monthly amount, and when the month is forecast to pass it.
variable "monthly_budget_usd" {
  type    = string
  default = "25"
}
variable "budget_email" {
  type        = string
  description = "Who receives the budget alerts and the server/backup alarms."
}

variable "admin_ssh_public_key" {
  type        = string
  description = "Your own SSH public key, for the default 'ubuntu' user."
}
variable "deploy_ssh_public_key" {
  type        = string
  description = "Public key of the CI deploy key (the private half is the GitHub secret DEPLOY_SSH_KEY)."
}
variable "ssh_allowed_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Who may reach SSH (key-only logins). GitHub's runners use many addresses, hence open by default."
}

variable "site_domain" {
  type        = string
  description = "Where the API answers (Vercel's NEST_URL), e.g. api.kachabiti.com, or api-test.kachabiti.com while testing."
}
