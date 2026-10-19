variable "environment" { type = string }
resource "null_resource" "this" {}
terraform {
  backend "s3" {}
}
