# Single Cloud SQL Postgres 16 instance hosting one database per service.
# Logical separation satisfies 12-Factor / DB-per-service while billing one
# instance (documented cost trade-off).
resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = var.db_instance_name
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier = var.db_tier
    backup_configuration { enabled = true }
    ip_configuration { ipv4_enabled = true }
  }

  deletion_protection = false
  depends_on          = [google_project_service.required["sqladmin.googleapis.com"]]
}

resource "google_sql_user" "app" {
  project  = var.project_id
  name     = var.db_user
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

resource "google_sql_database" "service" {
  for_each = var.service_databases
  project  = var.project_id
  name     = each.value
  instance = google_sql_database_instance.postgres.name
}

# Per-service DATABASE_URL secret. Connections go through the central PgBouncer
# Service (pgbouncer:6432, transaction pooling), which holds the only Cloud SQL
# Auth Proxy sidecar — app pods no longer connect to Cloud SQL directly.
resource "google_secret_manager_secret" "database_url" {
  for_each  = var.service_databases
  project   = var.project_id
  secret_id = "${replace(each.key, "-service", "")}-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "database_url" {
  for_each    = var.service_databases
  secret      = google_secret_manager_secret.database_url[each.key].id
  secret_data = "postgresql://${var.db_user}:${urlencode(var.db_password)}@pgbouncer:6432/${each.value}"
}

# PgBouncer auth_file line. Both the client auth (services → PgBouncer) and the
# upstream login (PgBouncer → Cloud SQL) use this single app user, so the same
# password serves both. Synced into the cluster by ESO (see pgbouncer.yaml).
resource "google_secret_manager_secret" "pgbouncer_userlist" {
  project   = var.project_id
  secret_id = "pgbouncer-userlist"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "pgbouncer_userlist" {
  secret      = google_secret_manager_secret.pgbouncer_userlist.id
  secret_data = "\"${var.db_user}\" \"${var.db_password}\"\n"
}
