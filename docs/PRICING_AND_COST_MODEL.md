# TravelManager — Pricing & Cost Model

## 1. Überblick

TravelManager ist eine SaaS-Plattform mit drei Tarifstufen. Das Abrechnungsmodell kombiniert
einen einmaligen Onboarding-Betrag (Standard) bzw. eine monatliche Grundgebühr (Enterprise)
mit **100 % nutzungsbasierter Abrechnung** auf vier Metering-Dimensionen. Free-Tenants werden
nicht abgerechnet.

---

## 2. Tarif-Struktur

| | **Free** | **Standard** | **Enterprise** |
|---|---|---|---|
| Onboarding / Setup | – | **€ 29,99** (einmalig) | individuell verhandelt |
| Monatliche Grundgebühr | – | – | **€ 499,00 / Monat** (api\_request base fee) |
| Nutzungsabrechnung | keine | ja (nur Overage) | ja (Overage + Grundgebühr) |
| API Rate-Limit | 60 req/min | 600 req/min | 6 000 req/min |
| Feed / Newsletter | ✗ | ✓ | ✓ |
| White-Label | ✗ | ✓ | ✓ |
| B2B-Analytics | ✗ | ✗ | ✓ |
| Datenbank | shared (Cloud SQL) | dedicated K8s StatefulSet + Postgres | dedicated K8s StatefulSet + Postgres |

> **Quelle:** `packages/shared/tiers.js` (Rate-Limits, Features),
> `services/metering-service/utils/schema.js` (DEFAULT\_CARDS, Grundgebühr),
> `packages/shared/rating.js` (Berechnungslogik)

---

## 3. Billing-Dimensionen und Rate Cards

### 3.1 Metering-Dimensionen

| Dimension | Was wird gemessen | Emit-Methode | Granularität |
|---|---|---|---|
| `api_request` | Jeder authentifizierte API-Call | Redis-Aggregation → Cron-Flush (1 min) | Hoch-volumen, gebatcht |
| `ai_recommendation` | Jeder KI-gestützte Reisevorschlag | Direkt via Pub/Sub | Niedrig-volumen, sofort |
| `active_seat` | Aktive Nutzer:innen je Tenant | Daily Cron Gauge-Snapshot (00:00) | Gauge (kein Summing) |
| `trip_created` | Jede neu angelegte Reise | Direkt via Pub/Sub | Niedrig-volumen, sofort |

### 3.2 Standard Rate Card

```
Einmaliger Setup: € 29,99 (PLANS.standard.oneTimeSetupCents = 2999)
Laufende Grundgebühr: KEINE (base_fee_cents = 0 auf allen Dimensionen)
```

| Dimension | Inklusiv-Kontingent | Overage-Preis | Basis (Cent) |
|---|---|---|---|
| `api_request` | 1 000 000 Req/Monat | **€ 0,0001** / Request (0,01 ct) | 0 |
| `ai_recommendation` | 5 000 Empfehlungen/Monat | **€ 0,02** / Empfehlung (2 ct) | 0 |
| `active_seat` | 5 Seats/Monat | **€ 5,00** / Seat (500 ct) | 0 |
| `trip_created` | 10 000 Reisen/Monat | **€ 0,01** / Reise (1 ct) | 0 |

### 3.3 Enterprise Rate Card

```
Monatliche Grundgebühr: € 499,00 (base_fee_cents = 49900 auf api_request)
Zusätzlich: Overage auf allen Dimensionen
```

| Dimension | Inklusiv-Kontingent | Overage-Preis | Basis (Cent) |
|---|---|---|---|
| `api_request` | 10 000 000 Req/Monat | **€ 0,00005** / Request (0,005 ct) | **49 900** (€ 499) |
| `ai_recommendation` | 100 000 Empfehlungen/Monat | **€ 0,01** / Empfehlung (1 ct) | 0 |
| `active_seat` | 50 Seats/Monat | **€ 4,00** / Seat (400 ct) | 0 |
| `trip_created` | 1 000 000 Reisen/Monat | **€ 0,005** / Reise (0,5 ct) | 0 |

> Enterprise-Tenants können per-Dimension **individuelle Overrides** erhalten
> (`tenant_rate_overrides` Tabelle, via Admin-API `PUT /api/admin/rate-cards/overrides/:tenantId`).
> Ein Override kann `includedQty` und/oder `unitRateCents` überschreiben; fehlendes Feld erbt den Plan-Wert.

---

## 4. Kostenberechnung (Formel)

```
Kosten pro Dimension = base_fee_cents + max(0, genutzt − inklusiv) × unit_rate_cents

Gesamtkosten = Σ aller Dimensionen (jeweils auf nächsten Cent gerundet)
```

Implementiert in `packages/shared/rating.js → computeCost()`.

**Besonderheiten:**
- Geldbeträge intern als **Cent-Integer** (BIGINT) gespeichert — kein Float-Drift
- `unit_rate_cents` ist `NUMERIC(12,4)` (z. B. 0,005 ct/Request) → Sub-Cent-Rates möglich
- Jede Dimensionszeile wird **einzeln gerundet** vor der Summation → Posten-Summe = Rechnungsbetrag
- Der Wert für `active_seat` ist ein **Gauge** (letzter Snapshot), kein kumulierter Zähler

### 4.1 Beispielrechnung: Standard-Tenant (kleines Startup)

| Dimension | Genutzt | Inklusiv | Overage | Preis | Kosten |
|---|---|---|---|---|---|
| `api_request` | 1 200 000 | 1 000 000 | 200 000 | 0,01 ct | **€ 20,00** |
| `ai_recommendation` | 3 000 | 5 000 | 0 | – | **€ 0,00** |
| `active_seat` | 8 | 5 | 3 | 500 ct | **€ 15,00** |
| `trip_created` | 12 000 | 10 000 | 2 000 | 1 ct | **€ 20,00** |
| **Gesamt** | | | | | **€ 55,00 / Monat** |

### 4.2 Beispielrechnung: Enterprise-Tenant (große Reiseplattform)

| Dimension | Genutzt | Inklusiv | Overage | Preis | Kosten |
|---|---|---|---|---|---|
| `api_request` | 8 000 000 | 10 000 000 | 0 | – | **€ 499,00** (Basis) |
| `ai_recommendation` | 120 000 | 100 000 | 20 000 | 1 ct | **€ 200,00** |
| `active_seat` | 45 | 50 | 0 | – | **€ 0,00** |
| `trip_created` | 500 000 | 1 000 000 | 0 | – | **€ 0,00** |
| **Gesamt** | | | | | **€ 699,00 / Monat** |

---

## 5. Technische Implementierung der Metering-Pipeline

```
API-Call
  └─► api-gateway/utils/usage-meter.js
        └─► Redis HINCRBY (per Tenant/Dimension)
              └─► flush-usage CronJob (60s)
                    └─► Pub/Sub topic "metering-usage"
                          └─► metering-service (ingest.js)
                                └─► usage_events Ledger (UNIQUE idempotency_key)
                                └─► usage_counters (pre-aggregated)
                                      └─► period-rollup CronJob (1. des Monats, 01:00)
                                            └─► invoices Tabelle (frozen JSONB)

Direkte Events (trip_created, ai_recommendation):
  trip-service → Pub/Sub → metering-service
```

**Idempotenz:** Jedes Pub/Sub-Event hat einen `idempotency_key`
(`flush:{tenant}:{dim}:{ts}`). Das Insert in `usage_events` schlägt bei Duplikaten
still fehl (`ON CONFLICT DO NOTHING`) → at-least-once Pub/Sub wird zu effectively-once.

**Seat-Snapshot:** `seat-snapshot` CronJob läuft täglich 00:00 und zählt Tenant-Members
aus der User-DB → emittiert `active_seat` als Gauge-Event (letzter Wert gewinnt, kein Aufaddieren).

---

## 6. Load-Test-Ergebnisse als Kapazitätsbasis

Die Load-Tests (`tests/load/`) liefern die Grundlage für Kapazitätsplanung und Preis-Kalibrierung.
Tool: **Locust 2.x**, User-Mix: 75 % BrowsingUser (anonym) + 25 % AuthedUser (Firebase-authenticated).

### 6.1 Steady-State (Smoke, flat 100 Users)

| Deployment | Median | p95 | p99 | RPS | Fehler |
|---|---|---|---|---|---|
| GCE IaaS (e2-standard-4) | 61 ms | 220 ms | 400 ms | 9,0 | 0,00 % |
| Cloud Run PaaS (3 Instanzen) | **44 ms** | **99 ms** | **200 ms** | 8,8 | 0,00 % |

→ Cloud Run liefert bei Warmstart den geringsten Tail-Latency.

### 6.2 Periodische Last (20 ↔ 100 Users, 4 Zyklen)

| Deployment | Median | p95 | p99 | RPS | Fehler |
|---|---|---|---|---|---|
| GCE IaaS | 71 ms | 350 ms | 650 ms | 10,8 | 0,31 % |
| Cloud Run PaaS | **55 ms** | **140 ms** | **220 ms** | **25,2** | 0,53 % |

→ Cloud Run skaliert unter Last aus (p99 220 ms vs. 650 ms bei GCE).
Der einzelne GCE-VM saturiert bei ~100 gleichzeitigen Nutzern.

### 6.3 Spike-Workload (10 → 500 Users)

| Deployment | Median | p95 | p99 | RPS | Max | Fehler |
|---|---|---|---|---|---|---|
| GCE IaaS | 140 ms | 1 700 ms | 5 100 ms | 84,2 | 6 700 ms | 0,09 % |
| Cloud Run PaaS | 160 ms | 2 100 ms | 5 600 ms | 82,8 | **49 003 ms** | 0,10 % |

→ GCE gewinnt beim Spike, weil bereits warm (4 vCPU). Cloud Run zahlt Cold-Start-Kosten
(12–49 s Worst-Case) während des Ramp-ups, holt dann auf.

### 6.4 Sättigungsgrenze (2 000 Users)

| Deployment | Shape | Median | p95 | p99 | RPS | Fehler |
|---|---|---|---|---|---|---|
| GCE IaaS | periodisch | 530 ms | **58 s** | 110 s | 35,6 | 0,08 % |
| Cloud Run PaaS | periodisch | 690 ms | **87 s** | 146 s | 23,6 | 1,41 % |

→ Beide Modelle saturiert bei 2 000 Users. IaaS hält höheren Durchsatz (kein Instance-Cap),
Cloud Run zeigt höhere Fehlerrate durch Queue-Overflow. Praktische **Sättigungsgrenze: ~100–500 User** je nach Workload.

### 6.5 Kapazitätsgrenzen als Pricing-Referenz

| Metrik | Wert | Relevanz |
|---|---|---|
| Cloud Run p95 (warm, 100 User) | 99 ms | SLA-Referenz für Standard-Tier |
| IaaS-VM Ceiling | ~100 gleichzeitige User | Grenze für Single-VM-Tenants |
| Cloud Run Cold Start | 12–49 s | Wird nicht in Billing berücksichtigt |
| DB-Pool-Grenze | > 2 000 User (10 Connections/Process) | Kein Pool-Exhaustion unter Normalbetrieb |
| Rate-Limit Standard | 600 req/min = **10 req/s** | Entspricht ~4 400 req/h inkl. Burst |
| Rate-Limit Enterprise | 6 000 req/min = **100 req/s** | Ausgelegt auf ~26 Mio req/Monat |

---

## 7. Herleitung der Rate Card-Werte

### 7.1 `api_request` — Warum 0,01 ct/Request (Standard)?

- Cloud Run kostet ca. **€ 0,40 / Mio Requests** (CPU-Zeit + Memory, europe-west6)
- Zuzüglich Cloud SQL, Redis, Pub/Sub: ca. **€ 0,80–1,20 / Mio Requests** Infrastrukturkosten
- Standard-Inklusivkontingent 1 Mio: deckt ~80 % aller kleinen Tenants vollständig ab
- Overage-Rate 0,01 ct = **€ 0,10 / 1 000 Requests** → ~8–12 % Marge über Infrastrukturkosten

### 7.2 `ai_recommendation` — Warum 2 ct/Empfehlung (Standard)?

- Embedding-Abfragen (pgvector) + externe KI-API-Calls: ca. 0,5–1 ct/Request
- Netzwerk + Latenz-Overhead: ~0,3 ct
- Rate: 2 ct = ca. **100–200 % Aufschlag** → höhere Marge für Premium-Feature

### 7.3 `active_seat` — Warum € 5,00/Seat (Standard)?

- Pro aktivem Nutzer: Redis-Session + DB-Row + Auth (Firebase) ≈ marginal
- Seat-Pricing folgt marktüblichem SaaS-Modell (z. B. Notion, Linear)
- Inklusiv 5 Seats deckt Solo-/Kleinst-Teams ab; 6. Seat kostet € 5

### 7.4 Enterprise-Grundgebühr € 499/Monat

- Dedicated K8s StatefulSet + Postgres-Pod: ca. **€ 80–120 / Monat** GKE-Nodekosten
- Cloud SQL Enterprise (db-custom-2-7680): ca. **€ 150 / Monat**
- Support, SLA, b2bData-Feature: ca. **€ 100 / Monat**
- Gesamt Infra+Support: ~**€ 330–370 / Monat** → Grundgebühr € 499 sichert Deckungsbeitrag

---

## 8. Abrechnungszyklus

| Schritt | Wann | Mechanismus |
|---|---|---|
| Usage-Aggregation | Real-time (60 s Latenz) | Redis-Counter → Pub/Sub-Flush |
| Seat-Snapshot | Täglich 00:00 | CronJob → Gauge-Event |
| Monats-Vorschau | Jederzeit abrufbar | `GET /api/usage/current` (Tenant) |
| Monatsrechnung | 1. des Monats, 01:00 | `period-rollup` CronJob → `invoices` Tabelle |
| Admin-Auswertung | Jederzeit | `GET /api/admin/usage/bulk?period=YYYY-MM` |

---

## 9. Enterprise Custom Pricing (Overrides)

Für Enterprise-Tenants können per Admin-API individuelle Konditionen gesetzt werden:

```http
PUT /api/admin/rate-cards/overrides/:tenantId
Content-Type: application/json

{
  "api_request":       { "unitRateCents": 0.003, "includedQty": 20000000 },
  "ai_recommendation": { "unitRateCents": 0.8 }
}
```

`null`-Felder erben den Plan-Wert. Eine Überschreibung gilt ab `effective_from`
(Standard: jetzt). Historische Rechnungen bleiben durch das versionsbasierte
`rate_cards`-Schema (PK: `plan, dimension, effective_from`) stabil.

---

## 10. Zusammenfassung

| | Free | Standard | Enterprise |
|---|---|---|---|
| Einstiegskosten | € 0 | **€ 29,99** (einmalig) | individuell |
| Laufende Fixkosten | – | – | **€ 499 / Monat** |
| Break-even Standard | – | > 1 Mio API-Calls | > 10 Mio API-Calls |
| Typische monatl. Rechnung | € 0 | **€ 0–200** | **€ 500–2 000+** |
| Skalierungsgrenze (Rate-Limit) | 60 req/min | 600 req/min | 6 000 req/min |
| Infra-Modell | shared | dedicated pod | dedicated pod + SLA |
