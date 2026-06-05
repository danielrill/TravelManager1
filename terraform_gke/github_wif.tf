# Workload Identity Federation for GitHub Actions.
#
# Lets the deploy.yml workflow authenticate to GCP with a short-lived OIDC
# token instead of a long-lived JSON key — no secret key ever leaves GitHub.
# The token is exchanged via STS for an impersonation of the github-deployer
# SA, restricted to this one repository.

# OIDC pool that trusts GitHub's token issuer.
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for TravelManager CI/CD"
  depends_on                = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens minted for our repo can use this provider — without this,
  # any GitHub repo on earth could request a token against the pool.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Deploy SA assumed by the workflow. Separate from the runtime SA
# (travelmanager-gke) so CI push/deploy rights never leak into pods.
resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
  depends_on   = [google_project_service.required["iam.googleapis.com"]]
}

locals {
  deploy_roles = [
    "roles/artifactregistry.writer", # docker push to the travelmanager repo
    "roles/container.developer",     # get-credentials + helm-manage k8s objects
  ]
}

resource "google_project_iam_member" "deploy" {
  for_each = toset(local.deploy_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deploy.email}"
}

# Allow GitHub Actions runs from var.github_repo to impersonate the deploy SA.
resource "google_service_account_iam_member" "deploy_wif" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
