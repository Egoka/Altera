<script setup lang="ts">
  /**
   * Вывод пользовательского изображения из вариантов медиафайла (`image-variants.md` §2 п. 5).
   *
   * `<picture>` с источником AVIF и запасным WebP; ширины браузер выбирает сам по `srcset` и
   * `sizes`. `NuxtImg` здесь не используется: варианты уже сделаны при загрузке, обработки на
   * лету нет и `/_ipx/` не вызывается (ADR-0030 п. 1–2).
   *
   * `alt` — всегда описание самого медиафайла: узел документа его не переопределяет (журнал
   * §29.13), поэтому компонент принимает готовое значение и ничего к нему не добавляет. Пустая
   * строка допустима: так помечается декоративное изображение.
   *
   * До загрузки варианта видно размытый заполнитель из набора — он лежит строкой `data:` в
   * записи и не стоит отдельного запроса (§2 п. 4).
   *
   * Изображения «в меру», «широкое» и «полное» (`06-design-system.md` §5) различаются только
   * значением `sizes`: разных файлов под них нет (§2 п. 5).
   */
  import { computed } from "vue"
  import { pictureSources } from "~/utils/mediaVariants"

  const props = withDefaults(
    defineProps<{
      /** Поле `variants` медиафайла как пришло из API. */
      variants: unknown
      /** Единое описание медиафайла; пустая строка — декоративное изображение. */
      alt: string
      /** Какую ширину займёт изображение в вёрстке места использования. */
      sizes?: string
      loading?: "lazy" | "eager"
      fetchpriority?: "high" | "low" | "auto"
      imgClass?: string
    }>(),
    {
      sizes: "100vw",
      loading: "lazy",
      fetchpriority: "auto",
      imgClass: ""
    }
  )

  const picture = computed(() => pictureSources(props.variants))
  // Размеры ставятся атрибутами, чтобы место под изображение резервировалось до его загрузки.
  const fallback = computed(() => picture.value.fallback)
  const placeholderStyle = computed(() =>
    picture.value.placeholder
      ? { backgroundImage: `url("${picture.value.placeholder}")`, backgroundSize: "cover" }
      : undefined
  )
</script>

<template>
  <picture v-if="fallback">
    <source
      v-for="source in picture.sources"
      :key="source.type"
      :type="source.type"
      :srcset="source.srcset"
      :sizes="sizes" />
    <img
      :src="fallback.url"
      :srcset="picture.fallbackSrcset"
      :sizes="sizes"
      :alt="alt"
      :width="fallback.width"
      :height="fallback.height"
      :loading="loading"
      :fetchpriority="fetchpriority"
      decoding="async"
      :class="imgClass"
      :style="placeholderStyle" />
  </picture>
</template>
