// Offset-paginated infinite scroll over an /api endpoint that returns an array.
//
// Usage:
//   const list = useInfiniteScroll(
//     ({ limit, offset }) => `/api/trips/all?limit=${limit}&offset=${offset}`,
//     { pageSize: 24, enabled: () => sortMode.value === 'newest' },
//   )
//   // template: v-for over list.items; <div ref="list.sentinel" /> at the bottom
//   list.reset()  // re-fetch from page 0 (call on search/sort change)
//
// The page owns *what* to fetch (buildUrl) and *whether* to paginate (enabled);
// this composable owns the offset bookkeeping, append, and the observer.
export function useInfiniteScroll(buildUrl, opts = {}) {
  const { apiFetch } = useApiFetch()
  const pageSize = opts.pageSize ?? 24
  const enabled  = opts.enabled ?? (() => true)

  const items       = ref([])
  const loading     = ref(true)   // starts true: every caller reset()s on mount
                                   // — avoids an empty-state flash before load
  const loadingMore = ref(false)  // appending a further page
  const hasMore     = ref(true)
  const error       = ref('')

  let offset = 0
  let seq = 0   // monotonic; a newer reset invalidates older in-flight responses

  async function load(reset) {
    if (reset) {
      offset = 0
      hasMore.value = true
      loading.value = true
    } else {
      if (!enabled() || !hasMore.value || loading.value || loadingMore.value) return
      loadingMore.value = true
    }

    const mySeq = ++seq
    try {
      const rows = await apiFetch(buildUrl({ limit: pageSize, offset }))
      const batch = Array.isArray(rows) ? rows : []
      if (mySeq !== seq) return   // superseded by a newer reset; drop this result
      items.value = reset ? batch : [...items.value, ...batch]
      offset += batch.length
      hasMore.value = enabled() && batch.length === pageSize
      error.value = ''
    } catch (e) {
      if (mySeq !== seq) return
      if (reset) items.value = []
      hasMore.value = false
      error.value = e?.data?.statusMessage || 'Failed to load.'
    } finally {
      if (mySeq === seq) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  const reset    = () => load(true)
  const loadMore = () => load(false)

  // Sentinel: observe a bottom element; load the next page as it nears view.
  const sentinel = ref(null)
  let observer = null
  onMounted(() => {
    observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore() },
      { rootMargin: '300px' },
    )
    watch(sentinel, (el) => {
      observer.disconnect()
      if (el) observer.observe(el)
    }, { immediate: true })
  })
  onBeforeUnmount(() => observer?.disconnect())

  return { items, loading, loadingMore, hasMore, error, reset, loadMore, sentinel }
}
