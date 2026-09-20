import type { H3Event } from "h3"
import {
  buildRssXml,
  feedPayloadData,
  buildSitemapIndexXml,
  buildSitemapUrlsetXml,
  FEED_CACHE_CONTROL,
  FEED_LOCALES,
  latestLastmod,
  LATEST_FEED_QUERY,
  RSS_ITEM_LIMIT,
  SITEMAP_ENTRIES_QUERY,
  type FeedLocale,
  type RssItem,
  type SitemapEntry
} from "./feeds"
import { proxyGraphQLRequest } from "./graphqlProxy"

// Обработчики машиночитаемых маршрутов (`docs/spec/20-public/feeds-and-sitemap.md`). Данные
// приходят из API тем же путём, что и запросы страниц: через подписанный прокси BFF.

/**
 * Данные фида из API. Отказ или недоступность источника — 503 `INTERNAL_ERROR` (§8): пустой
 * фид в ответ не подставляется, потому что для робота он означает «материалов больше нет».
 * Отдача последней успешно собранной версии (§8 `[ДОПУЩЕНИЕ]`) появится вместе со слоем
 * кеша ответов — сейчас его в вебе нет.
 */
const requestFeedData = async <T>(event: H3Event, query: string, variables: Record<string, unknown>): Promise<T> => {
  const requestId = event.context.requestId
  if (typeof requestId !== "string") throw new Error("Request ID middleware is not initialized")

  const runtimeConfig = useRuntimeConfig(event)
  const unavailable = () =>
    createError({
      statusCode: 503,
      statusMessage: "INTERNAL_ERROR",
      message: "Feed source is unavailable",
      data: { requestId }
    })

  let result: { status: number; body: unknown }

  try {
    result = await proxyGraphQLRequest({
      graphqlApiUrl: runtimeConfig.graphqlApiUrl,
      body: { query, variables },
      requestId,
      requestIdForwardSecret: runtimeConfig.requestIdForwardSecret,
      fetchRaw: (url, options) => $fetch.raw(url, options)
    })
  } catch {
    throw unavailable()
  }

  const data = feedPayloadData<T>(result.status, result.body)
  if (!data) throw unavailable()

  return data
}

const respondXml = (event: H3Event, contentType: string, body: string): string => {
  setResponseHeader(event, "content-type", contentType)
  setResponseHeader(event, "cache-control", FEED_CACHE_CONTROL)
  return body
}

/** Адрес запроса — источник origin: канонического адреса сайта в конфигурации проекта нет. */
const originOf = (event: H3Event): string => getRequestURL(event).origin

export const renderRssFeed = async (event: H3Event, locale: FeedLocale): Promise<string> => {
  const data = await requestFeedData<{ feed: { items: RssItem[] } }>(event, LATEST_FEED_QUERY, {
    locale,
    limit: RSS_ITEM_LIMIT
  })

  const xml = buildRssXml({ origin: originOf(event), locale, items: data.feed.items })
  return respondXml(event, "application/rss+xml; charset=utf-8", xml)
}

export const renderSitemapLocale = async (event: H3Event, locale: FeedLocale): Promise<string> => {
  const data = await requestFeedData<{ sitemapEntries: SitemapEntry[] }>(event, SITEMAP_ENTRIES_QUERY, { locale })

  const xml = buildSitemapUrlsetXml(originOf(event), locale, data.sitemapEntries)
  return respondXml(event, "application/xml; charset=utf-8", xml)
}

/**
 * Индекс карты сайта: строка на локаль с датой последнего изменения её адресов. Дата берётся
 * из той же выдачи, что собирает карту, — отдельного запроса «когда пересобрано» нет.
 */
export const renderSitemapIndex = async (event: H3Event): Promise<string> => {
  const locales = await Promise.all(
    FEED_LOCALES.map(async (locale) => {
      const data = await requestFeedData<{ sitemapEntries: SitemapEntry[] }>(event, SITEMAP_ENTRIES_QUERY, { locale })
      return { locale, lastmod: latestLastmod(data.sitemapEntries) }
    })
  )

  return respondXml(event, "application/xml; charset=utf-8", buildSitemapIndexXml(originOf(event), locales))
}
