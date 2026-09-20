import { renderSitemapLocale } from "../utils/feedRoutes"

// Карта русской локали (`feeds-and-sitemap.md` §5.3).
export default defineEventHandler((event) => renderSitemapLocale(event, "ru"))
