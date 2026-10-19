variable "name" {
  description = "Name prefix for all network resources"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
}

variable "flow_logs_bucket_arn" {
  description = "S3 bucket ARN that receives VPC flow logs"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
