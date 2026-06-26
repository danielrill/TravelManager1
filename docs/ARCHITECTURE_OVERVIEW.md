# TravelManager — Architekturübersicht

> Cloud Application Development · HTWG Konstanz · Sommersemester 2026

---

## Inhaltsverzeichnis

1. [Systemüberblick](#1-systemüberblick)
2. [C4 Systemkontext](#2-c4-systemkontext)
3. [Architekturmuster](#3-architekturmuster)
4. [Microservices & Verantwortlichkeiten](#4-microservices--verantwortlichkeiten)
5. [Komponentendiagramm (API-Gateway)](#5-komponentendiagramm-api-gateway)
6. [Datenbankarchitektur](#6-datenbankarchitektur)
7. [Multi-Tenancy-Modell](#7-multi-tenancy-modell)
8. [Asynchrone Ereignisverarbeitung](#8-asynchrone-ereignisverarbeitung)
9. [Anfrage-Lebenszyklus](#9-anfrage-lebenszyklus)
10. [Deployment & Infrastruktur](#10-deployment--infrastruktur)
11. [Authentifizierung & Autorisierung](#11-authentifizierung--autorisierung)
12. [Observability & Metering](#12-observability--metering)
13. [Lokale Entwicklungsumgebung](#13-lokale-entwicklungsumgebung)

---

## 1. Systemüberblick

**TravelManager** ist eine **B2B-SaaS-Plattform** für soziales Reiseplanen. Sie erlaubt Reisenden, Trips zu planen und zu teilen, empfängt automatische Reisewarnungen und -wetterberichte und bietet B2B-Partner-Analytics für Reisezieldestinationen.

| Merkmal | Ausprägung |
|---|---|
| **Architekturstil** | Cloud-native Microservices |
| **Laufzeitumgebung** | Google Kubernetes Engine (GKE Autopilot) |
| **Frontend** | Nuxt 3 SPA (Vue 3) |
| **Backend** | 8 Node.js-Microservices (Nitro/H3) |
| **Primäre Datenbank** | PostgreSQL 16 (Cloud SQL + pgvector) |
| **Messaging** | Google Cloud Pub/Sub |
| **Auth** | Firebase Authentication (JWT) |
| **IaC** | Terraform + Helm |

### Preispläne

| Plan | Kosten | Features | Datenbank |
|---|---|---|---|
| **Free** | $0 | Trip-Planung, Community | Shared (multitenant) |
| **Standard** | €29,99 Onboarding + nutzungsbasiert | + Feed, Newsletter, White-Label | Dedizierter Postgres-Pod |
| **Enterprise** | Individuell | + B2B-Daten, Premium-Support | Dedizierter Postgres-Pod |

---

## 2. C4 Systemkontext

### Ebene 1 — Systemkontext

```mermaid
C4Context
    title Systemkontext TravelManager

    Person(traveler, "Reisende/r", "Plant Trips, folgt anderen,\nerhält Warnungen & Newsletter")
    Person(b2b, "B2B-Destinationspartner", "Bezieht aggregierte Insights\nüber Reisende (Enterprise)")
    Person(operator, "Operator", "Verwaltet Tenants & Pläne\nüber Admin-Konsole")

    System(tm, "TravelManager", "SaaS-Plattform für soziales Reiseplanen\nmit Multi-Tenancy, Metering & Warnungen")

    System_Ext(firebase, "Firebase Auth", "Identitätsprovider\n(JWT-Ausstellung)")
    System_Ext(googlemaps, "Google Maps API", "Geocoding & Kartenansicht")
    System_Ext(rapidapi, "RapidAPI", "Echtzeit-Flüge, Hotels, Busse")
    System_Ext(vertexai, "Vertex AI", "Embedding-Vektoren für\nPersonalisierung")
    System_Ext(sendgrid, "SendGrid", "E-Mail-Versand\n(Warnungen, Newsletter)")
    System_Ext(auswamt, "Auswärtiges Amt API", "Offizielle Reisewarnungen")
    System_Ext(openmeteo, "Open-Meteo API", "Wetterdaten")

    Rel(traveler, tm, "Nutzt (HTTPS)", "Browser / SPA")
    Rel(b2b, tm, "Ruft B2B-Endpunkte ab", "HTTPS / REST")
    Rel(operator, tm, "Administriert via admin.onecloudaway.de", "HTTPS")

    Rel(tm, firebase, "Verifiziert JWTs", "HTTPS")
    Rel(tm, googlemaps, "Geocoding-Anfragen", "HTTPS")
    Rel(tm, rapidapi, "Flug-/Hoteldaten", "HTTPS")
    Rel(tm, vertexai, "Embedding-API", "gRPC")
    Rel(tm, sendgrid, "E-Mail-Versand", "HTTPS")
    Rel(tm, auswamt, "Reisewarnungen (Poll)", "HTTPS")
    Rel(tm, openmeteo, "Wetterdaten (Poll)", "HTTPS")
```

### Ebene 2 — Container

```mermaid
C4Container
    title Container-Diagramm TravelManager

    Person(user, "Nutzer/in", "Browser")

    Container_Boundary(k8s, "Google Kubernetes Engine (GKE Autopilot)") {
        Container(nginx, "Nginx Ingress", "nginx", "TLS-Terminierung, Host-Routing,\nstatische Assets")
        Container(frontend, "Frontend", "Nuxt 3 / Vue 3", "SPA: Trip-Planung, Social-Feed,\nAdmin-Konsole, B2B-Dashboard")
        Container(gateway, "API-Gateway", "Node.js / Nitro", "JWT-Verifikation, Rate-Limiting,\nFeature-Gating, Routing")
        Container(user_svc, "User-Service", "Node.js / Nitro", "Profile, Tenants, White-Label,\nPlan-Abonnements")
        Container(trip_svc, "Trip-Service", "Node.js / Nitro", "Trip-CRUD, Locations, Pläne,\nBewertungen, Likes, Embeddings")
        Container(dest_svc, "Destination-Service", "Node.js / Nitro", "Destinationskatalog, B2B-Analytics")
        Container(social_svc, "Social-Service", "Node.js / Nitro", "Follow-Graph, Feed-Aufbau,\nNewsletter-Generierung")
        Container(travelinfo_svc, "Travel-Info-Service", "Node.js / Nitro", "Reisewarnungen, Wetter,\nAlert-Matching (Polling-CronJob)")
        Container(notify_svc, "Notification-Service", "Node.js / Nitro", "E-Mail-Versand via SendGrid")
        Container(metering_svc, "Metering-Service", "Node.js / Nitro", "Nutzungsaufzeichnung,\nRechnungsstellung")
        Container(provisioner, "Provisioner-Service", "Node.js / Nitro", "Tenant-Provisionierung\n(K8s-StatefulSets)")

        ContainerDb(pg_shared, "Shared PostgreSQL", "PostgreSQL 16 + pgvector", "Shared Datenbanken für\nFree-Tier-Tenants")
        ContainerDb(pg_tenant, "Tenant-PostgreSQL", "PostgreSQL 16 (pro Tenant)", "Dedizierter Pod pro Standard/\nEnterprise-Tenant")
        ContainerDb(redis, "Redis", "Redis 7", "Caching, Rate-Limiting,\nUsage-Aggregation")
        ContainerDb(firestore, "Firestore", "Google Firestore", "Review-Kommentare\n(dokumentenbasiert)")
        Container(pubsub, "Pub/Sub", "Google Cloud Pub/Sub", "Async-Event-Backbone:\nTrips, Alerts, Newsletter, Usage")
    }

    Rel(user, nginx, "HTTPS", "443")
    Rel(nginx, frontend, "HTTP", "3000")
    Rel(nginx, gateway, "HTTP /api/*", "4000")
    Rel(frontend, gateway, "REST/JSON", "via Nginx")
    Rel(gateway, user_svc, "HTTP", "intern")
    Rel(gateway, trip_svc, "HTTP", "intern")
    Rel(gateway, dest_svc, "HTTP", "intern")
    Rel(gateway, social_svc, "HTTP", "intern")
    Rel(gateway, travelinfo_svc, "HTTP", "intern")
    Rel(gateway, metering_svc, "HTTP", "intern")
    Rel(trip_svc, pubsub, "Publish", "TripCreated/Updated")
    Rel(social_svc, pubsub, "Subscribe/Publish", "Feed/Newsletter")
    Rel(travelinfo_svc, pubsub, "Publish", "TravelAlert")
    Rel(notify_svc, pubsub, "Subscribe", "Alerts/Newsletter")
    Rel(metering_svc, pubsub, "Subscribe", "UsageRecorded")
    Rel(user_svc, pg_shared, "SQL", "travelmanager_user")
    Rel(trip_svc, pg_shared, "SQL", "travelmanager_trip")
    Rel(trip_svc, pg_tenant, "SQL", "per-tenant (Standard+)")
    Rel(trip_svc, firestore, "NoSQL", "Kommentare")
    Rel(gateway, redis, "Cache / Rate-Limit", "")
    Rel(user_svc, provisioner, "HTTP", "Provisionierung triggern")
```

---

## 3. Architekturmuster

### Überblick

```mermaid
graph TB
    subgraph "Präsentationsschicht"
        FE["Frontend (Nuxt 3 SPA)"]
        NGINX["Nginx Ingress / Reverse Proxy"]
    end

    subgraph "API-Schicht"
        GW["API-Gateway\n(Auth · Rate-Limit · Routing)"]
    end

    subgraph "Microservices (synchron)"
        US["User-Service"]
        TS["Trip-Service"]
        DS["Destination-Service"]
        SS["Social-Service"]
        TIS["Travel-Info-Service"]
        MS["Metering-Service"]
    end

    subgraph "Microservices (asynchron / CronJobs)"
        NS["Notification-Service"]
        PS["Provisioner-Service"]
    end

    subgraph "Datenhaltung"
        PG[("PostgreSQL\n(Shared + dediziert)")]
        RD[("Redis")]
        FS[("Firestore")]
        PSB["Google Cloud Pub/Sub"]
    end

    subgraph "Externe Dienste"
        FB["Firebase Auth"]
        GM["Google Maps"]
        VA["Vertex AI"]
        SG["SendGrid"]
        RA["RapidAPI"]
        AA["Auswärtiges Amt"]
        OM["Open-Meteo"]
    end

    FE --> NGINX --> GW
    GW --> US & TS & DS & SS & TIS & MS
    TS --> PSB --> NS & SS & MS
    TIS --> PSB
    GW --> FB
    TS --> VA & RA
    TIS --> AA & OM
    NS --> SG
    GW --> RD
    US & TS & DS & SS --> PG
    TS --> FS
    US --> PS
```

### 12-Factor-Compliance

```mermaid
graph LR
    subgraph "12 Factor App"
        F1["I · Codebase\nMonorepo / npm-Workspaces"]
        F2["II · Dependencies\nper-Service package.json"]
        F3["III · Config\nEnv-Vars (DATABASE_URL etc.)"]
        F4["IV · Backing Services\nCloud SQL, Pub/Sub, Redis"]
        F5["V · Build/Release/Run\nCI → Artifact Registry → Helm"]
        F6["VI · Processes\nStateless Services"]
        F7["VII · Port Binding\nNITRO_PORT=8080"]
        F8["VIII · Concurrency\nDeployments + HPA"]
        F9["IX · Disposability\nFast Boot, Graceful Shutdown"]
        F10["X · Dev/Prod Parity\ndocker-compose.dev.yml"]
        F11["XI · Logs\nStdout → Cloud Logging"]
        F12["XII · Admin Procs\nCronJobs (Warnungen, Newsletter)"]
    end
```

---

## 4. Microservices & Verantwortlichkeiten

```mermaid
graph TD
    subgraph GW_BOX["API-Gateway  (Port 4000)"]
        GW_AUTH["JWT-Verifikation\n(Firebase Admin)"]
        GW_RATE["Rate-Limiting\n(Redis Token-Bucket)"]
        GW_ROUTE["Service-Routing\n+ Feature-Gating"]
        GW_METER["Metering\n(UsageRecorded Events)"]
        GW_AUTH --> GW_RATE --> GW_ROUTE
        GW_ROUTE --> GW_METER
    end

    subgraph US_BOX["User-Service  (Port 8081)"]
        US1["Profile-Management"]
        US2["Tenant-Verwaltung"]
        US3["White-Label-Config"]
        US4["Plan-Abonnements"]
    end

    subgraph TS_BOX["Trip-Service  (Port 8082)"]
        TS1["Trip-CRUD"]
        TS2["Itinerary / Locations"]
        TS3["Bewertungen & Likes"]
        TS4["Embeddings (Vertex AI)"]
        TS5["RapidAPI-Integration"]
    end

    subgraph DS_BOX["Destination-Service  (Port 8083)"]
        DS1["Destinations-Katalog"]
        DS2["B2B-Aggregates\n(Enterprise only)"]
    end

    subgraph SS_BOX["Social-Service  (Port 8084)"]
        SS1["Follow-Graph"]
        SS2["Feed-Aufbau\n(Pub/Sub Subscriber)"]
        SS3["Newsletter-CronJob"]
    end

    subgraph TIS_BOX["Travel-Info-Service  (Port 8085)"]
        TIS1["Reisewarnungs-Poller\n(Auswärtiges Amt)"]
        TIS2["Wetter-Poller\n(Open-Meteo)"]
        TIS3["Alert-Matching"]
    end

    subgraph NS_BOX["Notification-Service  (asynchron)"]
        NS1["E-Mail-Versand\n(SendGrid)"]
        NS2["Throttling / Backoff"]
    end

    subgraph MS_BOX["Metering-Service  (asynchron)"]
        MS1["Usage-Aggregation"]
        MS2["Rechnungsstellung"]
        MS3["Rate-Card-Verwaltung"]
    end

    subgraph PROV_BOX["Provisioner-Service"]
        PROV1["K8s-StatefulSet-Erstellung\n(postgres-tenantId)"]
        PROV2["Secret-Manager\n(Credentials)"]
        PROV3["NetworkPolicy-Isolation"]
    end
```

---

## 5. Komponentendiagramm (API-Gateway)

Das API-Gateway ist der einzige Einstiegspunkt für alle Clientanfragen. Es übernimmt Authentifizierung, Autorisierung, Feature-Gating und das Routing zu den nachgelagerten Services.

```mermaid
flowchart TD
    REQ["Eingehende HTTP-Anfrage\n(Authorization: Bearer JWT)"]

    subgraph GATEWAY["API-Gateway"]
        TENANT["1. Tenant-Auflösung\nHost-Header → tenantId\n(Redis-Cache, 60s TTL)"]
        JWT["2. JWT-Verifikation\n(Firebase Admin SDK)"]
        RATE["3. Rate-Limiting\n(Redis Token-Bucket)\nFree: 60/min\nStandard: 600/min\nEnterprise: 6000/min"]
        FEAT["4. Feature-Gating\n(Plan-Check)"]
        HDR["5. Identity-Header-Injektion\nx-user-uid\nx-tenant-id\nx-plan\nx-role"]
        ROUTE["6. Proxy-Routing"]
        METER["7. Metering-Event\n(UsageRecorded → Pub/Sub)"]
    end

    TENANT --> JWT --> RATE --> FEAT --> HDR --> ROUTE --> METER

    ROUTE -->|"/api/users"| US["User-Service\n:8081"]
    ROUTE -->|"/api/trips"| TS["Trip-Service\n:8082"]
    ROUTE -->|"/api/destinations"| DS["Destination-Service\n:8083"]
    ROUTE -->|"/api/social"| SS["Social-Service\n:8084"]
    ROUTE -->|"/api/alerts"| TIS["Travel-Info-Service\n:8085"]
    ROUTE -->|"/api/usage"| MS["Metering-Service\n:8086"]

    REQ --> TENANT
```

---

## 6. Datenbankarchitektur

### Datenbankschema pro Service

```mermaid
erDiagram
    direction LR

    %% User-Service DB
    USERS {
        uuid id PK
        string firebase_uid UK
        string email
        string name
        string tenant_id FK
        string role
        timestamp created_at
    }
    TENANTS {
        string id PK
        string name
        string plan
        string subdomain UK
        string status
        timestamp created_at
    }
    WHITE_LABEL_CONFIG {
        uuid id PK
        string tenant_id FK
        string logo_url
        string brand_color
        string custom_domain
    }

    USERS }|--|| TENANTS : "gehört zu"
    TENANTS ||--o| WHITE_LABEL_CONFIG : "hat"

    %% Trip-Service DB
    TRIPS {
        uuid id PK
        string tenant_id
        string user_id FK
        string title
        text description
        date start_date
        date end_date
        boolean is_public
        float[] embedding
        timestamp created_at
    }
    LOCATIONS {
        uuid id PK
        uuid trip_id FK
        string name
        float lat
        float lng
        int order
    }
    REVIEWS {
        uuid id PK
        uuid trip_id FK
        string user_id
        int stars
        string comment_id
    }
    LIKES {
        uuid id PK
        uuid trip_id FK
        string user_id
    }

    TRIPS ||--o{ LOCATIONS : "hat"
    TRIPS ||--o{ REVIEWS : "hat"
    TRIPS ||--o{ LIKES : "hat"
```

### Multi-Tenant-Datenbankrouting

```mermaid
flowchart LR
    SVC["Microservice\ntenantDb(tenantId)"]

    SVC -->|"tenantId === 'default'\n(Free-Tier)"| SHARED[("Shared PostgreSQL\nCloud SQL\ntravelmanager_*")]
    SVC -->|"tenantId === 'tui'\n(Standard/Enterprise)"| DEDICATED[("Dedizierter Pod\npostgres-tui:5432\nK8s StatefulSet")]

    SHARED --> PG_USER[("travelmanager_user")]
    SHARED --> PG_TRIP[("travelmanager_trip")]
    SHARED --> PG_SOCIAL[("travelmanager_social")]
    SHARED --> PG_DEST[("travelmanager_destination")]
    SHARED --> PG_INFO[("travelmanager_travelinfo")]
    SHARED --> PG_NOTIFY[("travelmanager_notification")]

    DEDICATED --> PG_T_TRIP[("travelmanager_trip\n(isoliert)")]
    DEDICATED --> PG_T_SOCIAL[("travelmanager_social\n(isoliert)")]
```

---

## 7. Multi-Tenancy-Modell

Das Herzstück der Plattform ist ein **hybrides Multi-Tenancy-Modell**: Free-Tier-Tenants teilen sich Ressourcen, während Standard- und Enterprise-Kunden dedizierte Datenbankpods erhalten.

```mermaid
graph TB
    subgraph "Anfrage-Eingang"
        REQ["https://tui.onecloudaway.de/api/trips"]
        HOST["Host-Header: tui.onecloudaway.de"]
    end

    subgraph "Tenant-Identifikation (Gateway)"
        PARSE["Subdomain extrahieren: 'tui'"]
        LOOKUP["Redis-Cache-Lookup\n→ tenantId: 'tui', plan: 'standard'"]
        INJECT["x-tenant-id: tui\nx-plan: standard"]
    end

    subgraph "DB-Routing (tenant-db.js)"
        CHECK{"tenantId === 'default'?"}
        SHARED_POOL["Shared Pool\nCloud SQL"]
        DEDICATED_POOL["Dedicated Pool\npostgres-tui:5432\n(lazy erstellt + gecacht)"]
    end

    REQ --> HOST --> PARSE --> LOOKUP --> INJECT --> CHECK
    CHECK -->|"Ja (Free)"| SHARED_POOL
    CHECK -->|"Nein (Standard/Enterprise)"| DEDICATED_POOL
```

### Tenant-Provisionierung (Self-Serve)

```mermaid
sequenceDiagram
    actor User as Nutzer/in
    participant FE as Frontend
    participant GW as API-Gateway
    participant US as User-Service
    participant PROV as Provisioner-Service
    participant K8S as Kubernetes API
    participant SM as Secret Manager

    User->>FE: Klickt "Auf Standard upgraden"
    FE->>GW: POST /api/tenants/{id}/subscribe
    GW->>US: Weiterleitung (JWT verifiziert)
    US->>US: Tenant-Plan auf 'standard' setzen (status: 'provisioning')
    US->>PROV: POST /internal/provision {tenantId}
    US-->>FE: 202 Accepted {status: 'provisioning'}

    loop Status-Polling (alle 3s)
        FE->>GW: GET /api/tenants/{id}/status
        GW->>US: Status abfragen
        US-->>FE: {status: 'provisioning'}
    end

    PROV->>K8S: StatefulSet postgres-{tenantId} erstellen
    PROV->>K8S: Deployment trip-service-{tenantId} erstellen
    PROV->>K8S: NetworkPolicy erstellen
    PROV->>SM: Credentials als Secret speichern
    PROV->>US: Provisionierung abgeschlossen

    US->>US: Tenant-Status auf 'active' setzen
    FE->>GW: GET /api/tenants/{id}/status
    GW->>US: Status abfragen
    US-->>FE: {status: 'active'}
    FE-->>User: Redirect auf Dashboard
```

---

## 8. Asynchrone Ereignisverarbeitung

TravelManager nutzt **Google Cloud Pub/Sub** als Event-Backbone für alle nicht zeitkritischen Operationen.

### Event-Flow-Diagramm

```mermaid
flowchart LR
    subgraph "Quellen (Publisher)"
        GW_M["API-Gateway\nUsageRecorded"]
        TS_P["Trip-Service\nTripCreated\nTripUpdated"]
        TIS_P["Travel-Info-Service\nTravelAlert"]
        SS_P["Social-Service\nNewsletterReady"]
    end

    subgraph "Google Cloud Pub/Sub"
        T1[["Topic: trip-events"]]
        T2[["Topic: travel-alerts"]]
        T3[["Topic: newsletter-ready"]]
        T4[["Topic: usage-recorded"]]
        DLT[["Dead-Letter-Topic"]]
    end

    subgraph "Konsumenten (Subscriber)"
        SS_C["Social-Service\nFeed-Aufbau"]
        TIS_C["Travel-Info-Service\nAlert-Matching"]
        NS_C["Notification-Service\nE-Mail via SendGrid"]
        MS_C["Metering-Service\nNutzungs-Aggregation"]
    end

    TS_P --> T1
    TIS_P --> T2
    SS_P --> T3
    GW_M --> T4

    T1 --> SS_C
    T1 --> TIS_C
    T2 --> NS_C
    T3 --> NS_C
    T4 --> MS_C

    T1 -.-> DLT
    T2 -.-> DLT
    T3 -.-> DLT
    T4 -.-> DLT
```

### Sequenzdiagramm: Trip-Erstellung bis E-Mail-Warnung

```mermaid
sequenceDiagram
    actor U as Nutzer/in
    participant TS as Trip-Service
    participant PSB as Pub/Sub
    participant SS as Social-Service
    participant TIS as Travel-Info-Service
    participant NS as Notification-Service
    participant SG as SendGrid

    U->>TS: POST /api/trips (neuer Trip)
    TS->>TS: In Postgres speichern
    TS->>TS: Vertex-AI-Embedding berechnen
    TS-->>U: 201 Created {tripId}

    TS->>PSB: Publish TripCreated {tripId, userId, locations}

    par Feed-Aufbau (async)
        PSB->>SS: TripCreated Event
        SS->>SS: Follower abfragen
        SS->>SS: Feed-Einträge in DB schreiben
    and Warnungs-Matching (async)
        PSB->>TIS: TripCreated Event
        TIS->>TIS: Reisewarnung für Länder prüfen
        TIS->>PSB: Publish TravelAlert {userId, tripId, warning}
        PSB->>NS: TravelAlert Event
        NS->>SG: E-Mail senden
        SG-->>U: "Reisewarnung für dein Trip nach..."
    end
```

### Metering-Pipeline

```mermaid
flowchart TD
    REQ["HTTP-Anfrage\nan API-Gateway"]

    subgraph "Metering-Strategien"
        DIRECT["Direkt-Event\n(niedrig-frequente Operationen:\nTrip erstellt, AI-Empfehlung)"]
        REDIS_AGG["Redis-Aggregation\n(hoch-frequente Operationen:\nAPI-Requests)"]
    end

    subgraph "Flush-Prozess"
        CRON["CronJob\n(alle 60s)"]
        FLUSH["Aggregierte Zähler\n→ UsageRecorded-Events"]
    end

    PSB[["Pub/Sub\nusage-recorded"]]
    MS["Metering-Service\nUsage-Records in DB"]
    BILL["Rechnungsstellung\n(monatlich)"]

    REQ --> DIRECT & REDIS_AGG
    DIRECT --> PSB
    REDIS_AGG --> CRON --> FLUSH --> PSB
    PSB --> MS --> BILL
```

---

## 9. Anfrage-Lebenszyklus

### Vollständiger Request-Flow (authentifiziert)

```mermaid
sequenceDiagram
    actor B as Browser
    participant N as Nginx Ingress
    participant FE as Frontend (SSR/SPA)
    participant GW as API-Gateway
    participant REDIS as Redis
    participant FB as Firebase Auth
    participant US as User-Service
    participant PG as PostgreSQL

    B->>N: GET https://tui.onecloudaway.de/trips
    N->>FE: Weiterleitung (Port 3000)
    FE-->>B: SPA-HTML + JS

    B->>B: Firebase SDK lädt (JWT aus localStorage)
    B->>N: GET /api/trips (Bearer: <JWT>)
    N->>GW: Proxy-Anfrage

    GW->>REDIS: Tenant-Lookup: "tui"
    REDIS-->>GW: {tenantId: "tui", plan: "standard"}

    GW->>FB: JWT verifizieren (verifyIdToken)
    FB-->>GW: {uid: "abc123", email: "..."}

    GW->>REDIS: Rate-Limit prüfen (Token-Bucket)
    REDIS-->>GW: OK (unter 600/min)

    GW->>GW: Feature-Gate prüfen (plan: standard → OK)
    GW->>GW: x-user-uid, x-tenant-id, x-plan, x-role injizieren

    GW->>US: GET /api/trips (interne URL)\n(mit x-* Headers)
    US->>PG: SELECT * FROM trips WHERE tenant_id='tui'
    PG-->>US: Trip-Datensätze
    US-->>GW: JSON-Antwort
    GW-->>B: JSON-Antwort

    GW->>REDIS: Metering-Counter +1 (api_request:tui)
```

---

## 10. Deployment & Infrastruktur

### Kubernetes-Architektur (GKE Autopilot)

```mermaid
graph TB
    subgraph "Google Cloud Platform"
        subgraph "GKE Autopilot Cluster"
            subgraph "Ingress Layer"
                ING["GKE Ingress\n(Managed TLS, Static IP)"]
            end

            subgraph "Application Pods (Deployments + HPA)"
                FE_POD["frontend\n(Nuxt 3)"]
                GW_POD["api-gateway"]
                US_POD["user-service"]
                TS_POD["trip-service"]
                DS_POD["destination-service"]
                SS_POD["social-service"]
                TIS_POD["travel-info-service"]
                NS_POD["notification-service"]
                MS_POD["metering-service"]
            end

            subgraph "CronJobs"
                CJ1["travel-warning-poller\n(täglich)"]
                CJ2["newsletter-generator\n(wöchentlich)"]
                CJ3["metering-flush\n(minütlich)"]
            end

            subgraph "Tenant-dedizierte Pods (Standard+)"
                PG_TUI[("postgres-tui\nStatefulSet")]
                PG_ABC[("postgres-abc\nStatefulSet")]
                TS_TUI["trip-service-tui\nDeployment"]
                SS_TUI["social-service-tui\nDeployment"]
            end

            subgraph "Shared Infrastructure"
                PGB["PgBouncer\n(Connection Pooling)"]
                REDIS_POD[("Redis 7")]
                ESO["External Secrets Operator\n(Secret Manager → K8s Secrets)"]
            end
        end

        subgraph "Managed Services"
            CLOUDSQL[("Cloud SQL\nPostgreSQL 16\n+ pgvector")]
            PUBSUB[["Cloud Pub/Sub"]]
            AR["Artifact Registry\n(Container Images)"]
            SM_GCP["Secret Manager"]
            CL["Cloud Logging"]
            GMP["Google Managed Prometheus"]
        end
    end

    ING --> FE_POD & GW_POD
    GW_POD --> US_POD & TS_POD & DS_POD & SS_POD & TIS_POD & MS_POD
    US_POD & TS_POD & DS_POD --> PGB --> CLOUDSQL
    TS_POD & SS_POD --> PG_TUI & PG_ABC
    GW_POD & US_POD --> REDIS_POD
    TS_POD --> PUBSUB
    PUBSUB --> NS_POD & MS_POD & SS_POD
    ESO --> SM_GCP
```

### CI/CD-Pipeline

```mermaid
flowchart LR
    DEV["Entwickler/in\ngit push main"]
    GHA[".github/workflows/\ndeploy.yml"]

    subgraph "Build-Phase"
        BUILD["Docker multi-stage\nbuild (alle 8 Services)"]
        PUSH["Push zu\nArtifact Registry"]
    end

    subgraph "Deploy-Phase"
        AUTH["Workload Identity\nFederation\n(kein Service-Account-Key)"]
        HELM["helm upgrade --install\ntravelmanager ./k8s/travelmanager"]
        VERIFY["Health-Probe-Wait\n(/ready, /health)"]
    end

    DEV --> GHA --> BUILD --> PUSH --> AUTH --> HELM --> VERIFY
```

### Terraform-Infrastruktur

```mermaid
graph TD
    subgraph "terraform_gke/ (IaC)"
        TF_GKE["GKE Autopilot Cluster\n(google_container_cluster)"]
        TF_SQL["Cloud SQL\nPostgreSQL 16\n(google_sql_database_instance)"]
        TF_PSB["Pub/Sub Topics +\nSubscriptions + DLQ\n(google_pubsub_*)"]
        TF_AR["Artifact Registry\n(google_artifact_registry_repository)"]
        TF_SA["Service Accounts\n+ IAM Roles\n(google_service_account)"]
        TF_SM["Secret Manager\n(google_secret_manager_secret)"]
    end

    TF_GKE --> TF_SQL & TF_PSB & TF_AR
    TF_SA --> TF_SM
```

---

## 11. Authentifizierung & Autorisierung

```mermaid
flowchart TD
    subgraph "Client (Browser)"
        LOGIN["Login / Register\n(Firebase SDK)"]
        JWT_STORE["JWT in Memory\n(Firebase SDK verwaltet Refresh)"]
        REQ_HDR["Authorization: Bearer <JWT>\nbei jeder API-Anfrage"]
    end

    subgraph "API-Gateway"
        VERIFY["firebase.auth().verifyIdToken(jwt)\n→ {uid, email, ...}"]
        TENANT["Tenant aus Host-Header"]
        HEADERS["x-user-uid: abc123\nx-user-email: ...\nx-tenant-id: tui\nx-plan: standard\nx-role: traveler"]
    end

    subgraph "Microservices (intern)"
        IDENTITY["identity.js Middleware\n→ req.user = {uid, tenantId, plan, role}"]
        AUTH_CHECK["Rollen-/Plan-Prüfung\n(je nach Endpunkt)"]
    end

    LOGIN --> JWT_STORE --> REQ_HDR
    REQ_HDR --> VERIFY --> TENANT --> HEADERS
    HEADERS --> IDENTITY --> AUTH_CHECK
```

### Rollen & Pläne

| Rolle | Beschreibung | Zugriffsrechte |
|---|---|---|
| `traveler` | Standard-Nutzer/in | Eigene Trips, Community, Feed |
| `destinationMgr` | B2B-Partner | + B2B-Analytics-Endpunkte (Enterprise) |
| `operator` | Plattform-Admin | Admin-Konsole (admin.onecloudaway.de) |

| Plan | Rate-Limit | Features |
|---|---|---|
| `free` | 60 req/min | Basis-Trip-Planung |
| `standard` | 600 req/min | + Personalisierter Feed, Newsletter, White-Label |
| `enterprise` | 6.000 req/min | + B2B-Daten, Premium-Support |

---

## 12. Observability & Metering

```mermaid
graph LR
    subgraph "Instrumentierung"
        PROM["metrics.js\nPrometheus (RED-Metriken)\n- Rate (req/s)\n- Errors (4xx/5xx)\n- Duration (ms-Histogramm)"]
        OTEL["trace.js\nOpenTelemetry\n(Distributed Tracing)"]
        LOG["Strukturiertes Logging\n(stdout → Cloud Logging)"]
    end

    subgraph "Aggregation"
        GMP["Google Managed\nPrometheus"]
        CL["Cloud Logging\n+ Log-based Metrics"]
        CT["Cloud Trace"]
    end

    subgraph "Visualisierung & Alerting"
        DASH["Grafana Dashboards\n(Latenz, Fehlerrate, HPA-Scaling)"]
        ALERT["Cloud Monitoring Alerts\n(SLO-basiert)"]
    end

    PROM & OTEL & LOG --> GMP & CL & CT --> DASH & ALERT
```

### Billing-Dimensionen

| Dimension | Wann erfasst | Methode |
|---|---|---|
| `api_request` | Jede Gateway-Anfrage | Redis-Aggregation + Cron-Flush |
| `trip_created` | `POST /api/trips` | Direktes Pub/Sub-Event |
| `ai_recommendation` | Embedding-API-Aufruf | Direktes Pub/Sub-Event |
| `active_seat` | Täglicher Snapshot | CronJob |
| `newsletter_sent` | Newsletter-Versand | Direktes Pub/Sub-Event |

---

## 13. Lokale Entwicklungsumgebung

```mermaid
graph TB
    subgraph "docker-compose.dev.yml"
        NGINX_DEV["nginx\n(Port 80)\n/api → gateway:4000\n/ → frontend:3000"]
        FE_DEV["frontend\n(Port 3000)\nNuxt dev server"]
        GW_DEV["api-gateway\n(Port 4000)\nGATEWAY_SKIP_AUTH=1\nx-debug-uid Header"]
        US_DEV["user-service\n(Port 8081)"]
        TS_DEV["trip-service\n(Port 8082)"]
        DS_DEV["destination-service\n(Port 8083)"]
        SS_DEV["social-service\n(Port 8084)"]
        TIS_DEV["travel-info-service\n(Port 8085)"]
        PG_DEV[("PostgreSQL\n(Port 5432)\n+ pgvector"]
        PGB_DEV["PgBouncer\n(Port 5433)"]
        RD_DEV[("Redis\n(Port 6379)"]
    end

    NGINX_DEV --> FE_DEV & GW_DEV
    GW_DEV --> US_DEV & TS_DEV & DS_DEV & SS_DEV & TIS_DEV
    US_DEV & TS_DEV & DS_DEV & SS_DEV --> PGB_DEV --> PG_DEV
    GW_DEV --> RD_DEV
```

**Besonderheiten der lokalen Umgebung:**
- `GATEWAY_SKIP_AUTH=1` — JWT-Verifikation deaktiviert; Identität über `x-debug-uid`-Header setzbar
- `PUBSUB_DISABLED=1` — Pub/Sub-Events werden geloggt statt gesendet; Tasks manuell via `/api/tasks/*` triggerbar
- Gleiche `Dockerfile.service`-Images wie in Produktion → maximale Parität

---

## Verzeichnisstruktur (Überblick)

```
CloudApplicationDevelopment/
├── app/                        # Nuxt 3 SPA (Frontend)
│   ├── components/             # Vue-Komponenten
│   ├── composables/            # useAuth, useApiFetch, usePlan, ...
│   ├── pages/                  # Routen (trips, feed, community, b2b, ...)
│   ├── middleware/             # Route-Guards
│   └── plugins/                # WhiteLabel, Firebase-Client
├── services/
│   ├── api-gateway/            # Zentrales Gateway
│   ├── user-service/           # Profile & Tenants
│   ├── trip-service/           # Trip-Kernlogik
│   ├── destination-service/    # Destinations & B2B
│   ├── social-service/         # Feed & Newsletter
│   ├── travel-info-service/    # Warnungen & Wetter
│   ├── notification-service/   # E-Mail-Versand
│   ├── metering-service/       # Nutzungs-Billing
│   └── provisioner-service/    # Tenant-Provisionierung
├── packages/shared/            # Geteilte Module (npm-Workspace)
│   ├── db.js                   # Postgres-Pool-Factory
│   ├── tenant-db.js            # Multi-Tenant-DB-Routing
│   ├── cache.js                # Redis Read-Through
│   ├── pubsub.js               # Pub/Sub-Helfer
│   ├── tiers.js                # Plan-Definitionen (Source of Truth)
│   └── metering.js             # Usage-Recording
├── k8s/travelmanager/          # Helm-Chart
├── terraform_gke/              # IaC (GKE, Cloud SQL, Pub/Sub, ...)
├── nginx/                      # Reverse-Proxy-Konfigurationen
├── docs/                       # Weiterführende Dokumentation
│   ├── SOFTWARE_ARCHITECTURE.md
│   ├── METERING_AND_MONITORING.md
│   ├── SERVICE_MESH.md
│   └── architecture/           # C4-Diagramme (LikeC4)
├── tests/
│   ├── load/                   # Locust-Lasttests
│   └── unit/                   # Unit-Tests (Vitest)
├── docker-compose.dev.yml      # Lokaler Stack
└── .github/workflows/          # CI/CD (GitHub Actions)
```

---

*Generiert am 26.06.2026 · TravelManager v1.0 · HTWG Konstanz — Cloud Application Development*
