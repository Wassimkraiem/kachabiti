output "server_public_ip" {
  description = "The DNS A record of site_domain, the GitHub secret DEPLOY_HOST, and ssh ubuntu@<ip>."
  value       = aws_eip.server.public_ip
}

output "api_url" {
  description = "NEST_URL on Vercel and the GitHub variable API_URL."
  value       = "https://${var.site_domain}"
}

# The file storage part of the server .env and of the site's build settings (docs/DEPLOY.md).
output "server_env" {
  description = "Lines for the server .env: terraform output -raw server_env"
  value       = <<-EOT
    SITE_DOMAIN=${var.site_domain}
    S3_ENDPOINT=https://s3.${var.aws_region}.amazonaws.com
    S3_REGION=${var.aws_region}
    S3_PRODUCTS_BUCKET=${aws_s3_bucket.products.bucket}
    S3_DOCUMENTS_BUCKET=${aws_s3_bucket.documents.bucket}
    BACKUP_BUCKET=${aws_s3_bucket.backups.bucket}
    FILES_PUBLIC_URL=https://${aws_s3_bucket.products.bucket_regional_domain_name}
  EOT
}
