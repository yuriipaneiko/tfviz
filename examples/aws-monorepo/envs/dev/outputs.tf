output "site_url" {
  value = "https://${aws_route53_record.site.fqdn}"
}

output "alb_dns_name" {
  value = module.app.alb_dns_name
}
