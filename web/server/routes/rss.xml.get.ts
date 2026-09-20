import { renderRssFeed } from "../utils/feedRoutes"

// Лента русской локали (`docs/spec/20-public/feeds-and-sitemap.md` §3).
export default defineEventHandler((event) => renderRssFeed(event, "ru"))
