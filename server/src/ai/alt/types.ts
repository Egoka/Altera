/**
 * Интерфейс адаптера AI-описания изображения (T-067).
 *
 * Отдельный шаг обработки медиа: лёгкая модель определяет, что изображено, и результат
 * сохраняется в `alt` самого медиафайла. Это не анализ статьи и не зависит от её текста
 * (журнал §29.11, `85-media-and-binary/upload-pipeline.md` п. 6а), поэтому вход адаптера — байты
 * мастер-файла, а не подача материала.
 *
 * Реализации: `fake` (детерминированное описание по фикстуре) и `unavailable` (провайдер
 * не подключён). `real` на YandexGPT (журнал §34 п. 4) в объём T-067 не входит: выбор модели,
 * языки и стоимость — отдельный проход.
 */

/** Мастер-файл изображения: байты без метаданных и его известные конвейеру свойства. */
export interface AiAltImage {
  assetId: string
  mimeType: string
  width: number | null
  height: number | null
  body: Buffer
}

export interface AiAltResult {
  /** Единственный результат шага: описание, которое станет `alt` медиафайла. */
  alt: string
  model: string
  promptVersion: string
  /**
   * Стоимость обращения в копейках. Как и у проверки допустимости, попадает только в агрегат по
   * периоду: у отдельной записи AI-процесса стоимости нет (журнал §27.4).
   */
  costMinor: number
}

export interface AiAltAdapter {
  readonly name: string
  readonly model: string
  /** Версия промпта; пишется в запись AI-процесса (`40-admin/ai-processes.md` §3). */
  readonly promptVersion: string
  describe(image: AiAltImage): Promise<AiAltResult>
}
