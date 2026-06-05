# Non-database secrets pulled into the cluster by External Secrets Operator.
resource "google_secret_manager_secret" "rapidapi_key" {
  project   = var.project_id
  secret_id = "rapidapi-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}
resource "google_secret_manager_secret_version" "rapidapi_key" {
  secret      = google_secret_manager_secret.rapidapi_key.id
  secret_data = var.rapidapi_key
}

resource "google_secret_manager_secret" "resend_api_key" {
  project   = var.project_id
  secret_id = "resend-api-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "resend_api_key" {
  secret      = google_secret_manager_secret.resend_api_key.id
  secret_data = var.resend_api_key
}

resource "google_secret_manager_secret" "firebase_service_account" {
  project   = var.project_id
  secret_id = "firebase-service-account"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "firebase_service_account" {
  secret      = google_secret_manager_secret.firebase_service_account.id
  secret_data = var.firebase_service_account
}

resource "google_secret_manager_secret" "google_maps_server_key" {
  project   = var.project_id
  secret_id = "google-maps-server-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "google_maps_server_key" {
  secret      = google_secret_manager_secret.google_maps_server_key.id
  secret_data = var.google_maps_server_key
}
