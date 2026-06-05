# Memorystore for Redis — shared cache + multi-replica gateway state (tenant/plan
# resolution + rate-limit buckets). A cache, not a source of truth, so BASIC tier
# (single node, no replica/failover): a node loss just empties the cache and the
# app fails open to Postgres.
#
# DIRECT_PEERING on the default VPC: Memorystore reserves an internal range and
# peers it automatically; the Autopilot cluster (same default network) reaches it
# over private IP. No proxy/sidecar needed.
resource "google_redis_instance" "cache" {
  project            = var.project_id
  name               = var.redis_instance_name
  tier               = "BASIC"
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = "default"
  connect_mode       = "DIRECT_PEERING"
  redis_version      = "REDIS_7_2"

  depends_on = [google_project_service.required["redis.googleapis.com"]]
}

# REDIS_URL pulled into the cluster by External Secrets Operator, same pattern as
# the per-service database_url secrets. BASIC tier has no AUTH by default, so the
# URL is host:port only (reachable solely from the peered VPC).
resource "google_secret_manager_secret" "redis_url" {
  project   = var.project_id
  secret_id = "redis-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.id
  secret_data = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
}
