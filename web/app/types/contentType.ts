type ContentTypeStatus = "active" | "archived"
export default interface ContentType {
  id: string
  name: string
  slug: string
  description?: string
  iconUrl?: string
  order: number
  status: ContentTypeStatus
  createdAt: string
  updatedAt: string
}
