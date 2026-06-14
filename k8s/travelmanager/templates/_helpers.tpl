{{/* Common labels */}}
{{- define "tm.labels" -}}
app.kubernetes.io/part-of: travelmanager
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Image reference for a service */}}
{{- define "tm.image" -}}
{{- printf "%s/%s:%s" .root.Values.global.imageRegistry .name .root.Values.global.imageTag -}}
{{- end -}}

{{/*
Shared env block. Internal service URLs use cluster DNS. DB + secret values come
from the per-service ExternalSecret (envFrom) so they are not rendered here.
*/}}
{{- define "tm.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: NITRO_HOST
  value: "0.0.0.0"
- name: NITRO_PORT
  value: "8080"
- name: GOOGLE_CLOUD_PROJECT
  value: {{ .Values.global.gcpProject | quote }}
- name: VERTEX_LOCATION
  value: {{ .Values.global.vertexLocation | default .Values.global.region | default "europe-west1" | quote }}
- name: FROM_EMAIL
  value: {{ .Values.global.fromEmail | default "alerts@onecloudaway.de" | quote }}
- name: APP_BASE_URL
  value: {{ .Values.global.appBaseUrl | default (printf "https://%s" (.Values.global.rootDomain | default "onecloudaway.de")) | quote }}
- name: USER_SERVICE_URL
  value: "http://user-service:8080"
- name: TRIP_SERVICE_URL
  value: "http://trip-service:8080"
- name: DESTINATION_SERVICE_URL
  value: "http://destination-service:8080"
- name: SOCIAL_SERVICE_URL
  value: "http://social-service:8080"
- name: TRAVEL_INFO_SERVICE_URL
  value: "http://travel-info-service:8080"
- name: PROVISIONER_SERVICE_URL
  value: "http://provisioner-service:8080"
# --- Multitenancy ---
- name: ROOT_DOMAIN
  value: {{ .Values.global.rootDomain | default "onecloudaway.de" | quote }}
- name: ADMIN_EMAILS
  value: {{ .Values.global.adminEmails | default "" | quote }}
- name: PROVISIONER_K8S_ENABLED
  value: {{ if .Values.global.provisionerK8sEnabled }}"1"{{ else }}"0"{{ end }}
- name: PROVISIONER_NAMESPACE
  value: {{ .Release.Namespace | quote }}
- name: TENANT_DB_SECRET
  value: {{ .Values.global.tenantDbSecret | default "tenant-db-credential" | quote }}
- name: TENANT_DB_HOST_SUFFIX
  value: {{ .Values.global.tenantDbHostSuffix | default "" | quote }}
- name: TENANT_DB_PORT
  value: "5432"
# Per-tenant dedicated application pods: the provisioner stamps these out as
# <svc>-<tenant> Deployments. Needs the image coords + scaling bounds; the gateway
# reads TENANT_DEDICATED_PODS to route a tenant's traffic to its own pods.
- name: TENANT_DEDICATED_PODS
  value: {{ if .Values.global.tenantDedicatedPods }}"1"{{ else }}"0"{{ end }}
- name: TENANT_APP_IMAGE_REGISTRY
  value: {{ .Values.global.imageRegistry | quote }}
- name: TENANT_APP_IMAGE_TAG
  value: {{ .Values.global.imageTag | quote }}
- name: TENANT_APP_IMAGE_PULL_POLICY
  value: {{ .Values.global.imagePullPolicy | default "Always" | quote }}
- name: TENANT_APP_HPA_MIN
  value: {{ .Values.global.tenantAppHpaMin | default 1 | quote }}
- name: TENANT_APP_HPA_MAX
  value: {{ .Values.global.tenantAppHpaMax | default 2 | quote }}
# Shared tenant-pod DB credential (optional: absent locally → tenant-db defaults).
- name: TENANT_DB_USER
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.tenantDbSecret | default "tenant-db-credential" | quote }}
      key: username
      optional: true
- name: TENANT_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.tenantDbSecret | default "tenant-db-credential" | quote }}
      key: password
      optional: true
{{- range .Values.global.extraEnv }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
{{- end -}}

{{/* Cloud SQL Auth Proxy sidecar container */}}
{{- define "tm.cloudSqlSidecar" -}}
- name: cloud-sql-proxy
  image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.1
  args:
    - "--structured-logs"
    - "--port=5432"
    - {{ .Values.global.cloudSqlInstance | quote }}
  securityContext:
    runAsNonRoot: true
    runAsUser: 65532   # cloud-sql-proxy distroless nonroot uid (Autopilot needs an explicit uid)
  resources:
    requests: { cpu: 50m, memory: 64Mi }
    limits: { cpu: 200m, memory: 128Mi }
{{- end -}}
