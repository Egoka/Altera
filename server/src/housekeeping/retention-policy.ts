/**
 * Единственное место сроков хранения, по которым работает housekeeping
 * (`docs/spec/80-observability/retention-and-pd.md` §2 п. 2, `docs/vision/08-operations.md` §11).
 * Значения с пометкой `[ДОПУЩЕНИЕ]` остаются допущениями спецификации до решения владельца.
 *
 * Аудит (`audit_logs`), история рабочих статусов ошибок, платежи, согласия и слаги сюда не входят:
 * они хранятся бессрочно, и housekeeping их не трогает.
 */
export interface RetentionPolicy {
  readonly sessionAfterExpiryDays: number
  readonly oneTimeTokenAfterExpiryDays: number
  readonly autosaveRevisionDays: number
  readonly backendErrorDays: number
  readonly pageErrorEventDays: number
  readonly runIntervalMs: number
}

export const RETENTION_POLICY: RetentionPolicy = {
  /** Сессии — 30 дней после истечения (`session-lifecycle.md` п. 11). */
  sessionAfterExpiryDays: 30,
  /**
   * Токены входа и коды смены почты — до использования или истечения (ADR-0022): запас после
   * истечения не нужен, хранятся только хэши.
   */
  oneTimeTokenAfterExpiryDays: 0,
  /**
   * Прореживание `autosave`-ревизий старше 30 дней; ручные снимки остаются (журнал §6.7).
   * `[ДОПУЩЕНИЕ: прореживание — удаление старых автосохранений, кроме последней ревизии перевода
   * и ревизий, на которые есть ссылки; правило отбора спецификация не задаёт]`.
   */
  autosaveRevisionDays: 30,
  /** Техническая история ошибок — 90 дней `[ДОПУЩЕНИЕ]` (`error-collector.md` п. 2). */
  backendErrorDays: 90,
  /**
   * Фронтовые `page.error` в неизменяемой истории ошибок — 30 дней (реестр событий #64); остальные
   * события этой истории (`backend.error` #81 и др.) живут `backendErrorDays`.
   */
  pageErrorEventDays: 30,
  /** Период постановки задания `[ДОПУЩЕНИЕ: спецификация говорит «по расписанию» без частоты]`. */
  runIntervalMs: 60 * 60_000
}
