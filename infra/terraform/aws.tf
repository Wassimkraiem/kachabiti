# The API on AWS: one EC2 instance (Graviton ARM, t4g.small by default) in the default VPC runs
# Postgres, the NestJS API and Caddy (HTTPS) from deploy/docker-compose.prod.yml; files and backups are
# in S3, reached with the instance's role (no stored keys). The site is on Vercel.
# The Free plan pays with credits for up to 6 months; the budget below warns before real charges.

data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "server" {
  name        = "kachabity-server"
  description = "Kachabity server: the site over HTTP/HTTPS (Caddy) and SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP (Caddy redirects to HTTPS and answers the certificate challenge)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "SSH (key-only, see cloud-init.yaml)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_key_pair" "admin" {
  key_name   = "kachabity-admin"
  public_key = var.admin_ssh_public_key
}

# The server's role: read and write the three buckets, nothing else.
resource "aws_iam_role" "server" {
  name = "kachabity-server"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "server_buckets" {
  name = "buckets"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [for bucket in local.buckets : "${bucket.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [for bucket in local.buckets : bucket.arn]
      },
    ]
  })
}

# backup.sh reports each finished backup as a metric (alarm backup_missing below), only in its namespace.
resource "aws_iam_role_policy" "server_metrics" {
  name = "metrics"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "cloudwatch:PutMetricData"
      Resource  = "*"
      Condition = { StringEquals = { "cloudwatch:namespace" = "Kachabity" } }
    }]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "kachabity-server"
  role = aws_iam_role.server.name
}

resource "aws_instance" "server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.admin.key_name
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name
  # The database lives on this disk: a console click or terraform destroy can't terminate it (turn off first).
  disable_api_termination = true

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    deploy_ssh_public_key = var.deploy_ssh_public_key
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = var.disk_gb
    encrypted   = true
    tags        = { Name = "kachabity", Snapshots = "daily" } # picked up by aws_dlm_lifecycle_policy.server
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
    # 2: the API reaches the role's keys from inside its Docker container (one more network hop).
    http_put_response_hop_limit = 2
  }

  tags = { Name = "kachabity" }

  # A newer Ubuntu image or an edited cloud-init must not rebuild the server (and its database).
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# A fixed public IP: the DNS record, DEPLOY_HOST and your SSH access don't change on restarts.
resource "aws_eip" "server" {
  instance = aws_instance.server.id
  domain   = "vpc"
  tags     = { Name = "kachabity" }
}

# Daily snapshots of the server's disk (the database included), the last var.snapshot_days kept.
# They restore the whole server; the nightly pg_dump in S3 (deploy/backup.sh) restores the database alone.
resource "aws_iam_role" "snapshots" {
  name = "kachabity-snapshots"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "dlm.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "snapshots" {
  role       = aws_iam_role.snapshots.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "server" {
  description        = "Daily snapshots of the kachabity server disk"
  execution_role_arn = aws_iam_role.snapshots.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshots = "daily" }

    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["01:00"] # UTC, before the 02:30 pg_dump
      }
      retain_rule {
        count = var.snapshot_days
      }
    }
  }
}

# S3 bucket names are global, hence a random suffix.
resource "random_id" "buckets" {
  byte_length = 3
}

resource "aws_s3_bucket" "products" {
  bucket = "kachabity-products-${random_id.buckets.hex}"
}

resource "aws_s3_bucket" "documents" {
  bucket = "kachabity-documents-${random_id.buckets.hex}"
}

resource "aws_s3_bucket" "backups" {
  bucket = "kachabity-backups-${random_id.buckets.hex}"
}

locals {
  buckets = [aws_s3_bucket.products, aws_s3_bucket.documents, aws_s3_bucket.backups]
}

# Product photos are public (FILES_PUBLIC_URL); documents and backups stay private (the default).
resource "aws_s3_bucket_public_access_block" "products" {
  bucket                  = aws_s3_bucket.products.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "products_public_read" {
  bucket = aws_s3_bucket.products.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = "*", Action = "s3:GetObject", Resource = "${aws_s3_bucket.products.arn}/*" }]
  })
  depends_on = [aws_s3_bucket_public_access_block.products]
}

# Backups are kept 30 days (deploy/backup.sh uploads one an hour).
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

# An e-mail when this month's costs reach 80% of the limit, or are forecast to pass it.
resource "aws_budgets_budget" "monthly" {
  name         = "kachabity-monthly"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}

# Alerts by e-mail to budget_email (confirm the subscription e-mail AWS sends after the first apply).
resource "aws_sns_topic" "alerts" {
  name = "kachabity-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.budget_email
}

# No successful backup for 2 hours (backup.sh runs hourly): the dump, the upload or the server failed.
resource "aws_cloudwatch_metric_alarm" "backup_missing" {
  alarm_name          = "kachabity-backup-missing"
  alarm_description   = "No database backup reached S3 in the last 2 hours (see /var/log/kachabity-backup.log)."
  namespace           = "Kachabity"
  metric_name         = "BackupSucceeded"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# AWS hardware or network fault: move the instance to healthy hardware (same disk, IP and data).
resource "aws_cloudwatch_metric_alarm" "server_system_check" {
  alarm_name          = "kachabity-server-system-check"
  alarm_description   = "AWS-side fault on the server; EC2 is recovering it onto other hardware."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn, "arn:aws:automate:${var.aws_region}:ec2:recover"]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The server itself stopped answering (out of memory, hung kernel): reboot it. Postgres recovers from its log.
resource "aws_cloudwatch_metric_alarm" "server_instance_check" {
  alarm_name          = "kachabity-server-instance-check"
  alarm_description   = "The server stopped responding; EC2 is rebooting it."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn, "arn:aws:automate:${var.aws_region}:ec2:reboot"]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
