import { renderSitemapLocale } from "../utils/feedRoutes"

// Карта английской локали (`feeds-and-sitemap.md` §5.3).
export default defineEventHandler((event) => renderSitemapLocale(event, "en"))
