/**
 * Корзина агрегата стоимости AI. Общая для всех видов процессов: стоимость хранится только в
 * агрегатах по периодам, у отдельной записи её нет и показать её невозможно (журнал §27.4).
 */

/**
 * Суточная корзина в UTC `[ДОПУЩЕНИЕ]`: `AiCostAggregate` требует границ периода, а спецификация
 * величину корзины не задаёт — раздел показывает стоимость «за период»
 * (`40-admin/ai-processes.md` §3).
 */
export function aiCostBucket(at: Date): { bucketStart: Date; bucketEnd: Date } {
  const bucketStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  return { bucketStart, bucketEnd: new Date(bucketStart.getTime() + 24 * 60 * 60 * 1_000) }
}
