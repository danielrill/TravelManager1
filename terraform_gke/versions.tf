terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "required" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # SA impersonation via WIF
    "sts.googleapis.com",            # OIDC token exchange (GitHub Actions)
    "pubsub.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
