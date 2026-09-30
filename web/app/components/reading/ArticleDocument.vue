<script lang="ts">
  import {
    isRenderText,
    readDocument,
    renderDocument,
    type ContentMark,
    type RenderAsset,
    type RenderChild,
    type RenderElement,
    type RenderText
  } from "@altera/content"
  import { computed, defineComponent, h, type PropType, type VNodeChild } from "vue"
  import MediaPicture from "~/components/media/Picture.vue"

  interface ArticleBodyAsset {
    id: string
    alt?: string | null
    caption?: string | null
    attribution?: string | null
    width?: number | null
    height?: number | null
    variants: unknown
  }

  const blockClass = "mx-auto w-full max-w-3xl px-5 sm:px-8"

  export default defineComponent({
    name: "ArticleDocument",
    props: {
      document: { type: Object as PropType<unknown>, required: true },
      assets: { type: Array as PropType<ArticleBodyAsset[]>, required: true }
    },
    setup(props) {
      const assetsById = computed(() => new Map(props.assets.map((asset) => [asset.id, asset])))
      const tree = computed(() => {
        const document = readDocument(props.document)
        return renderDocument(document, {
          resolveAsset: (assetId): RenderAsset | null => {
            const asset = assetsById.value.get(assetId)
            if (!asset) return null
            return {
              assetId,
              alt: asset.alt,
              caption: asset.caption,
              attribution: asset.attribution,
              width: asset.width,
              height: asset.height
            }
          }
        })
      })

      const markedText = (text: RenderText): VNodeChild => {
        let child: VNodeChild = text.text
        for (const mark of text.marks) child = applyMark(mark, child)
        return child
      }

      const childrenOf = (node: RenderElement): VNodeChild[] =>
        node.children.map((child: RenderChild) => (isRenderText(child) ? markedText(child) : renderNode(child)))

      const renderFigure = (node: RenderElement): VNodeChild => {
        const assetId = String(node.props.assetId ?? "")
        const asset = assetsById.value.get(assetId)
        const size = String(node.props.size ?? "normal")
        const caption = [node.props.caption, node.props.attribution].filter(Boolean).map(String)
        const widthClass =
          size === "full"
            ? "relative left-1/2 w-screen -translate-x-1/2"
            : size === "wide"
              ? "mx-auto w-full max-w-6xl px-5 sm:px-8"
              : blockClass
        const sizes =
          size === "full"
            ? "100vw"
            : size === "wide"
              ? "(min-width: 1280px) 1152px, 100vw"
              : "(min-width: 768px) 768px, 100vw"

        return h(
          "figure",
          { id: node.props.id, class: `${widthClass} my-12` },
          asset
            ? [
                h(MediaPicture, {
                  variants: asset.variants,
                  alt: asset.alt ?? "",
                  sizes,
                  imgClass: "block h-auto w-full bg-zinc-100 object-cover dark:bg-zinc-900"
                }),
                caption.length
                  ? h(
                      "figcaption",
                      { class: "mt-3 flex flex-wrap gap-x-2 px-1 font-sans text-xs/5 text-zinc-500" },
                      caption.flatMap((part, index) => [index > 0 ? " " : "", h("span", {}, part)])
                    )
                  : null
              ]
            : [
                h(
                  "div",
                  {
                    class:
                      "flex aspect-[3/2] items-center justify-center border border-zinc-300 bg-zinc-50 px-8 text-center font-sans text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                  },
                  String(node.props.alt ?? "")
                )
              ]
        )
      }

      const renderNode = (node: RenderElement): VNodeChild => {
        const id = node.props.id as string | undefined
        switch (node.component) {
          case "ProseArticle":
            return h("article", { class: "article-document pb-8" }, childrenOf(node))
          case "ProseParagraph":
            return h(
              "p",
              { id, class: `${blockClass} mb-7 font-serif text-[1.125rem]/8 text-zinc-800 dark:text-zinc-200` },
              childrenOf(node)
            )
          case "ProseHeading": {
            const tag = node.props.level === 3 ? "h3" : "h2"
            const classes =
              tag === "h2"
                ? `${blockClass} mb-5 mt-16 font-serif text-3xl/10 font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-4xl/12`
                : `${blockClass} mb-4 mt-12 font-serif text-2xl/9 font-semibold text-zinc-950 dark:text-white`
            return h(tag, { id, class: classes }, childrenOf(node))
          }
          case "ProseQuote":
            return h(
              "blockquote",
              {
                id,
                class: `${blockClass} my-10 border-l-4 border-orange-600 py-2 pl-7 font-serif text-xl/8 italic text-zinc-700 dark:text-zinc-300`
              },
              childrenOf(node)
            )
          case "ProseList":
            return h(
              node.props.ordered ? "ol" : "ul",
              {
                id,
                class: `${blockClass} mb-8 space-y-3 pl-12 font-serif text-[1.125rem]/8 text-zinc-800 marker:text-orange-700 dark:text-zinc-200`
              },
              childrenOf(node)
            )
          case "ProseListItem":
            return h("li", { id, class: node.props.ordered ? "list-decimal" : "list-disc" }, childrenOf(node))
          case "ProseFigure":
            return renderFigure(node)
          case "ProseDivider":
            return h("hr", {
              id,
              class: `${blockClass} my-14 border-0 before:block before:border-t before:border-zinc-300 dark:before:border-zinc-700`
            })
          default:
            return null
        }
      }

      return () => renderNode(tree.value)
    }
  })

  function applyMark(mark: ContentMark, child: VNodeChild): VNodeChild {
    if (mark.type === "bold") return h("strong", { class: "font-semibold" }, [child])
    if (mark.type === "italic") return h("em", {}, [child])
    if (mark.type === "link") {
      return h(
        "a",
        {
          href: String((mark.attrs ?? {}).href ?? ""),
          rel: "noopener noreferrer",
          class:
            "text-orange-800 underline decoration-orange-300 underline-offset-4 hover:decoration-orange-700 dark:text-orange-300"
        },
        [child]
      )
    }
    return child
  }
</script>
