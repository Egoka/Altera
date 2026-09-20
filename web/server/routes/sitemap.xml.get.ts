import { renderSitemapIndex } from "../utils/feedRoutes"

// Индекс карты сайта: ссылки на карты локалей (`feeds-and-sitemap.md` §5.2).
export default defineEventHandler((event) => renderSitemapIndex(event))
