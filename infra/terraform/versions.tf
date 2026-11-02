# The production infrastructure (docs/DEPLOY.md) on AWS: one EC2 ARM instance that runs Postgres,
# the NestJS API and Caddy (deploy/docker-compose.prod.yml), and the S3 buckets for files and backups.
# The site is on Vercel.
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State in an S3 bucket you create once by hand (docs/DEPLOY.md):
  # terraform init -backend-config=backend.hcl
  backend "s3" {}
}

# Credentials from the environment: aws configure export-credentials (docs/DEPLOY.md).
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = { Project = "kachabity" }
  }
}
