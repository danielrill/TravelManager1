// Distributed-trace context propagation for the service mesh (Cloud Service Mesh /
// Istio). The Envoy sidecar GENERATES spans per hop, but only stitches them into a
// single end-to-end trace if the app forwards the propagation headers from the
// inbound request onto its outbound calls. Node/Nitro doesn't do this automatically,
// so every request-path $fetch to another service must spread traceHeaders(event).
//
// We forward the full set Istio understands: B3 (Zipkin), W3C Trace Context, the
// Envoy request id, and the GCP Cloud Trace header — so propagation works whichever
// the mesh is configured to use.
const TRACE_HEADERS = [
  'x-request-id',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3-parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
  'x-ot-span-context',
  'traceparent',
  'tracestate',
  'baggage',
  'x-cloud-trace-context',
]

// Extract the trace-context headers from an inbound h3 event, ready to spread into
// a $fetch `headers` object. Returns {} when there's no event/headers (cron and
// other background callers have no inbound trace to continue — they start a fresh
// one), so this is always safe to spread.
export function traceHeaders(event) {
  const h = event?.node?.req?.headers
  if (!h) return {}
  const out = {}
  for (const name of TRACE_HEADERS) {
    const v = h[name]
    if (v != null) out[name] = Array.isArray(v) ? v.join(',') : String(v)
  }
  return out
}

// The header names we propagate (exported for tests / proxy header allowlists).
export const PROPAGATED_TRACE_HEADERS = TRACE_HEADERS
