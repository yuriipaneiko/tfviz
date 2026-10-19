output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "events_topic_arn" {
  value = aws_sns_topic.events.arn
}
