import crypto from "crypto"

const canonicalize = (value: unknown): string => {
  if (value === undefined) return '["undefined"]'
  if (value === null) return '["null"]'

  if (Array.isArray(value)) {
    return `["array",[${value.map(canonicalize).join(",")}]]`
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `[${JSON.stringify(key)},${canonicalize(item)}]`)
    return `["object",[${entries.join(",")}]]`
  }

  return JSON.stringify([typeof value, value])
}

export const buildCacheKey = (namespace: string, args: Readonly<Record<string, unknown>>): string => {
  const digest = crypto.createHash("sha256").update(canonicalize(args)).digest("hex")
  return `cache:v1:data:${namespace}:${digest}`
}

interface ArticleCacheIdentity {
  slug: string
  author?: { slug: string } | null
  contentType?: { slug: string } | null
  sectionTags?: readonly { slug: string }[]
}

export const buildArticleCacheTags = (...articles: readonly ArticleCacheIdentity[]): string[] => {
  const tags = new Set<string>(["home"])

  for (const article of articles) {
    tags.add(`article:${article.slug}`)
    if (article.author) tags.add(`author:${article.author.slug}`)
    if (article.contentType) tags.add(`content-type:${article.contentType.slug}`)
    article.sectionTags?.forEach((tag) => tags.add(`section-tag:${tag.slug}`))
  }

  return [...tags].sort()
}
