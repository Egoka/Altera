import { computed, onMounted, onUnmounted, ref } from "vue"

export interface CachedPage {
  path: string
  title: string
  section: string | null
  visitedAt: string | null
}

export type CachedPagesState = "loading" | "ready" | "unavailable"

/** Личное и административное офлайн не кешируется (ADR-0019, `offline.md` §4). */
const PRIVATE_PREFIXES = ["/me", "/admin", "/auth", "/api", "/_nuxt", "/offline"]

/** Не больше 50 страниц — граница кеша по `offline.md` §4. */
const MAX_PAGES = 50

export const isCacheablePath = (path: string): boolean => {
  if (path === "/" || path === "/en") return false
  return !PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

const titleOf = (html: string): string | null => {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title = raw?.replace(/\s+/g, " ").trim()
  return title ? title : null
}

/** Рубрика материала — первый сегмент адреса (`ADR-0004`: `/{рубрика}/{слаг}`). */
const sectionOf = (path: string): string | null => {
  const segments = path.split("/").filter(Boolean)
  const withoutLocale = segments[0] === "en" ? segments.slice(1) : segments
  return withoutLocale.length >= 2 ? (withoutLocale[0] ?? null) : null
}

export const readCachedPages = async (storage: CacheStorage, origin: string): Promise<CachedPage[]> => {
  const pages = new Map<string, CachedPage>()

  for (const name of await storage.keys()) {
    const cache = await storage.open(name)
    for (const request of await cache.keys()) {
      if (pages.size >= MAX_PAGES) break
      if (request.method !== "GET") continue

      const url = new URL(request.url)
      if (url.origin !== origin || !isCacheablePath(url.pathname) || pages.has(url.pathname)) continue

      const response = await cache.match(request)
      if (!response || !response.headers.get("content-type")?.includes("text/html")) continue

      const title = titleOf(await response.text())
      if (!title) continue

      pages.set(url.pathname, {
        path: url.pathname,
        title,
        section: sectionOf(url.pathname),
        visitedAt: response.headers.get("date")
      })
    }
  }

  return [...pages.values()]
}

/**
 * Офлайн-страница (`docs/spec/20-public/offline.md`): список сохранённого читается из Cache
 * Storage, запросов к API нет (§4). В приватном режиме хранилища нет вовсе — это состояние
 * «ошибка данных» §8, список тогда не показывается.
 *
 * Предкеширование и сам service worker — этап 3 (§1): до него список пуст, а страница уже
 * умеет ждать сеть и возвращать читателя на запрошенный адрес.
 */
export const useOfflinePage = () => {
  const route = useRoute()

  const state = ref<CachedPagesState>("loading")
  const pages = ref<CachedPage[]>([])
  const retrying = ref(false)
  const requestedCached = ref<boolean | null>(null)

  /** Адрес, который читатель запрашивал: его подставляет service worker при показе страницы. */
  const requestedPath = computed(() => {
    const raw = route.query.from
    const value = Array.isArray(raw) ? raw[0] : raw
    return typeof value === "string" && value.startsWith("/") ? value : null
  })

  const storage = (): CacheStorage | null =>
    typeof window !== "undefined" && "caches" in window ? window.caches : null

  const load = async () => {
    const caches = storage()
    if (!caches) {
      state.value = "unavailable"
      return
    }

    try {
      pages.value = await readCachedPages(caches, window.location.origin)
      requestedCached.value = requestedPath.value ? Boolean(await caches.match(requestedPath.value)) : null
      state.value = "ready"
    } catch {
      pages.value = []
      state.value = "unavailable"
    }
  }

  const retry = () => {
    if (typeof window === "undefined") return
    retrying.value = true
    window.location.assign(requestedPath.value ?? "/")
  }

  // Сеть вернулась — страница сама уходит на исходный адрес (§3, §7).
  const onOnline = () => retry()

  onMounted(() => {
    load()
    window.addEventListener("online", onOnline)
  })
  onUnmounted(() => {
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline)
  })

  return { state, pages, retrying, requestedPath, requestedCached, retry, reload: load }
}
