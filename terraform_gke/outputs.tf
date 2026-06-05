output "cluster_name" {
  value = google_container_cluster.primary.name
}
output "cluster_location" {
  value = google_container_cluster.primary.location
}
output "ingress_ip" {
  value = google_compute_global_address.ingress.address
}
output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
output "cloud_sql_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}
output "gke_runtime_sa" {
  value = google_service_account.gke_runtime.email
}
output "redis_host" {
  value = google_redis_instance.cache.host
}

# --- GitHub Actions (deploy.yml) -------------------------------------------
# Set these as repository secrets:
#   gh secret set WIF_PROVIDER       -b "$(terraform output -raw wif_provider)"
#   gh secret set DEPLOY_SA          -b "$(terraform output -raw deploy_sa)"
#   gh secret set GCP_PROJECT        -b "$(terraform output -raw project_id)"
#   gh secret set CLOUD_SQL_INSTANCE -b "$(terraform output -raw cloud_sql_connection_name)"
# Plus the public NUXT_PUBLIC_* Firebase/Maps values (not managed here).
output "wif_provider" {
  description = "WIF_PROVIDER secret — full provider resource name"
  value       = google_iam_workload_identity_pool_provider.github.name
}
output "deploy_sa" {
  description = "DEPLOY_SA secret — deployer service account email"
  value       = google_service_account.deploy.email
}
output "project_id" {
  description = "GCP_PROJECT secret"
  value       = var.project_id
}
