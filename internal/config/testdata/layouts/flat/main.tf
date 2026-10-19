variable "environment" { type = string }
terraform {
  backend "s3" {}
}
