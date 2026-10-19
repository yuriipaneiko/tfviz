terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Mock credentials so `terraform plan` works without an AWS account.
provider "aws" {
  region                      = var.region
  access_key                  = "mock"
  secret_key                  = "mock"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

locals {
  name = "shop"
  tags = {
    Project     = "shop"
    Environment = var.environment
  }
}

module "network" {
  source = "../../modules/network"

  name                 = local.name
  azs                  = var.azs
  cidr_block           = "10.10.0.0/16"
  flow_logs_bucket_arn = aws_s3_bucket.logs.arn
  tags                 = local.tags
}

module "app" {
  source = "../../modules/web-app"

  name               = local.name
  environment        = var.environment
  region             = var.region
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  certificate_arn    = aws_acm_certificate.site.arn
  desired_count      = 1
}

resource "aws_s3_bucket" "logs" {
  bucket = "${local.name}-${var.environment}-logs"
  tags   = local.tags
}

resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-${var.environment}-site"
  tags   = local.tags
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  index_document {
    suffix = "index.html"
  }
}

resource "aws_acm_certificate" "site" {
  domain_name       = "${var.environment}.${var.domain}"
  validation_method = "DNS"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = ["${var.environment}.${var.domain}"]

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "site"
  }

  origin {
    domain_name = module.app.alb_dns_name
    origin_id   = "api"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.site.arn
    ssl_support_method  = "sni-only"
  }
}

resource "aws_route53_zone" "main" {
  name = var.domain
}

resource "aws_route53_record" "site" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.environment}.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
