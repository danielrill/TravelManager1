# TravelManager — Deployment & Push Workflow

*Final presentation document. Companion: `01-cloud-application-overview.md`.*

**Headline question: does it deploy fully automatically via Flux on push to `main`?**
**→ YES.** After a one-time setup, a `git push` to `main` reaches the live cluster
in ~10–15 minutes with **zero operator action**.

---

## 1. TL;DR

```
git push main ──► GitHub Actions builds+pushes 9 images ──► Flux scans registry
   ──► Flux commits new tag to IaC repo ──► Flux re-renders Helm ──► pods roll
```

Two repos cooperate:
- **`TravelManager`** (app) — CI builds & pushes container images.
- **`TravelManagerIaC`** (infra) — Flux watches the registry + the IaC repo and reconciles the cluster.

No `kubectl apply`, no `helm upgrade` by hand. Git is the source of truth.

---

## 2. CI — GitHub Actions (app repo)

**File:** `.github/workflows/deploy.yml`

- **Trigger:** push to `main` (+ `workflow_dispatch`).
- **Paths allowlist** — builds only on relevant changes: `services/**`, `packages/**`, `app/**`, `tests/**`, `nuxt.config.js`, `jsconfig.json`, `Dockerfile`, `Dockerfile.service`, `vitest.config.js`, `package*.json`, the workflow file itself.
  - ⚠️ A root file **not** in this list (e.g. a stray config) pushes but **builds nothing silently** — verify with `gh run list` after such pushes.
- **Steps:** run tests → build **9 images** (8 services + frontend) → push to **Artifact Registry** via **Workload Identity Federation** (no JSON keys).
- **Registry:** `europe-west1-docker.pkg.dev/project-3f93c20d-…/travelmanager/<service>`.
- **Tagging — 3 tags per image:**
  1. `main-<unix-timestamp>-<short-sha>`  ← primary, sortable
  2. `<short-sha>`
  3. `latest`

> **Invariant:** the `main-<ts>-<sha>` tag is computed **once** in a `prep` job
> and reused for all 9 images. The Helm chart references a single
> `global.imageTag`, so every service **must** share the identical tag — per-job
> timestamps would desync the frontend from the backends.

---

## 3. Flux image automation (IaC repo)

**Dir:** `TravelManagerIaC/image-automation/` — three linked CRDs:

| CRD | File | Role |
|-----|------|------|
| **ImageRepository** | `image-repository.yaml` | Scans the **api-gateway** Artifact Registry repo every **5m** (`provider: gcp`, Workload Identity). api-gateway is the representative — all 9 share the tag. |
| **ImagePolicy** | `image-policy.yaml` | Pattern `^main-(?P<ts>[0-9]+)-[a-f0-9]+$`, extracts `$ts`, `numerical` `order: asc` → highest timestamp = newest. Ignores `latest` / sha-only tags. |
| **ImageUpdateAutomation** | `image-update-automation.yaml` | Every 5m: rewrites the `imageTag` **setter marker** in the HelmRelease, commits to `main` as `fluxcdbot` (**no PR gate**), message `chore(deploy): bump travelmanager image to <tag>`. |

---

## 4. Flux Kustomization chain (IaC repo)

**Root:** `clusters/prod/kustomization.yaml`. Source = `GitRepository` (`gotk-sync.yaml`), Flux **v2.8.8**.

Ordered by `dependsOn`:

```
flux-system (controllers + image-reflector + image-automation)
   └─ eso.yaml            External Secrets Operator (CRDs, wait:true)
        └─ infra.yaml     Namespace + ClusterSecretStore  (dependsOn eso)
             └─ apps.yaml HelmRelease: travelmanager        (dependsOn infra)
                  ├─ mesh.yaml             Istio CRs: mTLS, Telemetry, DestinationRule (wait:false)
                  └─ image-automation.yaml ImageRepository/Policy/UpdateAutomation
```

---

## 5. HelmRelease

**File:** `clusters/prod/apps/travelmanager.yaml`

```yaml
spec:
  interval: 5m
  chart:
    spec:
      chart: ./charts/travelmanager
      reconcileStrategy: Revision      # ← critical
      sourceRef: { kind: GitRepository, name: flux-system }
  values:
    global:
      imageRegistry: europe-west1-docker.pkg.dev/project-3f93c20d-…/travelmanager
      imageTag: "main-1782547858-d3ad4119dcd0" # {"$imagepolicy": "flux-system:travelmanager-images:tag"}
```

- **`reconcileStrategy: Revision`** is mandatory: `Chart.yaml` is pinned at static
  `version: 0.1.0`, so the default `ChartVersion` strategy would **silently no-op**
  template/value edits. `Revision` re-renders on *any* git change.
- Image rendered by the `tm.image` helper (`_helpers.tpl`):
  `{registry}/{name}:{global.imageTag}` → all 9 Deployments roll together.

---

## 6. End-to-end chain + timeline

```
┌─ developer pushes to main (app repo) ─────────────────────────────┐
│ t+0    GitHub Actions: test → build 9 images → push (WIF)          │
│ t+1-3  Images in Artifact Registry, tag main-<ts>-<sha>            │
│ t+3-8  Flux ImageRepository scans (5m interval)                    │
│ t+8-13 ImagePolicy picks newest → ImageUpdateAutomation commits    │
│        the new tag to TravelManagerIaC main (fluxcdbot)            │
│ t+13-18 HelmRelease polls git (5m) → re-renders (Revision) →       │
│         helm upgrade → Deployments roll to new image               │
│ t+18-23 Pods evict + restart, readiness probes gate rollout        │
└────────────────── ~10–15 min, zero operator action ───────────────┘
```

```
push ─► GHA build/push ─► Artifact Registry
                              │ (scan 5m)
                              ▼
                       ImageRepository ─► ImagePolicy ─► ImageUpdateAutomation
                                                              │ (git commit to main)
                                                              ▼
                                                    TravelManagerIaC repo
                                                              │ (GitRepository poll 5m)
                                                              ▼
                                                    HelmRelease (Revision) ─► helm upgrade
                                                              ▼
                                                    GKE Deployments roll
```

---

## 7. One-time manual setup (operators only)

After this, **everything is automatic**.

1. **Terraform** — `cd terraform_gke && terraform apply` (creates cluster, SQL, IAM, registry; grants `roles/artifactregistry.reader` to runtime SA).
2. **Flux bootstrap with image controllers:**
   ```bash
   flux bootstrap github --owner=cikoglukai --repository=TravelManagerIaC \
     --branch=main --path=clusters/prod \
     --components-extra=image-reflector-controller,image-automation-controller
   ```
3. **Workload Identity annotation** on the image reflector (else no registry access):
   ```bash
   kubectl annotate sa image-reflector-controller -n flux-system \
     iam.gke.io/gcp-service-account=travelmanager-gke@<PROJECT>.iam.gserviceaccount.com
   kubectl rollout restart deploy/image-reflector-controller -n flux-system
   ```
4. **Post-terraform one-offs:** grant node SA `roles/container.defaultNodeServiceAccount`;
   `CREATE EXTENSION vector` on Cloud SQL (pgvector); upload wildcard TLS cert; point DNS at the ingress IP.

---

## 8. Gotchas

| Gotcha | Consequence | Fix |
|--------|-------------|-----|
| `reconcileStrategy` default = `ChartVersion` | Template/value edits silently ignored (Chart.yaml static at 0.1.0) | Use `Revision` (already set) |
| Per-service image tags | Frontend/backend version skew | One shared `main-<ts>-<sha>` computed once in `prep` |
| Missing WI annotation on image-reflector | ImageRepository finds no tags → no deploys | Annotate KSA + restart |
| Paths allowlist in `deploy.yml` | Unlisted file pushes build nothing | Add path or accept no-build; verify `gh run list` |
| ImageUpdateAutomation pushes to `main` | No PR gate (by design, fast loop) | Commits are atomic (tag only) |
| `commonEnv` vs `extraEnv` | CI `--set global.extraEnv` clobbers added env | Put new global env in `commonEnv` in `_helpers.tpl` |

---

## 9. Verdict — is full auto-deploy live?

| Step | Automatic? | Where |
|------|:----------:|-------|
| Build images | ✅ | `deploy.yml` (push to main) |
| Push to registry | ✅ | `deploy.yml` (WIF) |
| Scan registry | ✅ | `image-repository.yaml` (5m) |
| Select newest image | ✅ | `image-policy.yaml` (numerical) |
| Update git manifest | ✅ | `image-update-automation.yaml` (commit to main) |
| Reconcile HelmRelease | ✅ | `travelmanager.yaml` (`Revision`, 5m) |
| Roll pods | ✅ | Kubernetes Deployment rollout |

**Conclusion: end-to-end automatic.** Push to `main` → live in ~10–15 min, no
human in the loop. The only manual work is the one-time bootstrap above.
