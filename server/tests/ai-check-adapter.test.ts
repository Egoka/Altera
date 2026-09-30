/**
 * T-048, критерий готовности 1: с `fake` статья с фикстурой «отказ» получает комментарий
 * с причинами по категориям.
 *
 * Здесь же проверяются остальные части объёма: бинарность вердикта, недоступность провайдера как
 * `PROVIDER_UNAVAILABLE: ai` с повтором задания, запрет второго вердикта по той же записи,
 * аудит `ai.decision` и выбор реализации по окружению.
 */

import { createDocument, createParagraph, createText, createFigure } from "@altera/content"
import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { createAiCheckAdapterFromEnv } from "../src/ai/config"
import { createFakeAiCheckAdapter, parseFakeAiCheckMarker } from "../src/ai/adapters/fake"
import { createUnavailableAiCheckAdapter } from "../src/ai/adapters/unavailable"
import { aiCheckCategoryTitle } from "../src/ai/reasons"
import { createAiCheckService } from "../src/ai/service"
import { AI_CHECK_JOB_KIND, parseAiCheckJobParameters } from "../src/ai/queue"
import { KNOWN_JOB_KINDS } from "../src/admin/jobs"
import { AUDIT_CODE_ZONES } from "../src/audit/registry"
import { LOG_EVENT_CODES } from "../src/observability/log-events"
import type { AppLogger, LogEntry, MetricEntry } from "../src/observability/logger"
import { createAiCheckMemoryStore, type AiCheckStoreFixture } from "./helpers/ai-check-memory-store"

/** Идентификаторы узлов и медиафайлов каталог проверяет как uuid (`@altera/content`). */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

const TRANSLATION_ID = "translation-1"
const REVISION_ID = "revision-1"
const COVER_ID = uuid(900)
const BODY_ASSET_ID = uuid(901)
const BLOCK_ONE = uuid(1)
const BLOCK_TWO = uuid(2)
const BLOCK_THREE = uuid(3)

function createLogCollector() {
  const entries: Array<LogEntry | MetricEntry> = []
  const logger: AppLogger = {
    log: (entry) => void entries.push(entry),
    metric: (entry) => void entries.push(entry)
  }
  return { logger, entries }
}

function fixture(overrides: Partial<AiCheckStoreFixture> = {}): AiCheckStoreFixture {
  return {
    translationId: TRANSLATION_ID,
    revisionId: REVISION_ID,
    latestRevisionId: REVISION_ID,
    articleId: "article-1",
    status: "ai_check",
    articleStatus: "ai_check",
    updatedAt: new Date("2026-09-28T11:59:00.000Z"),
    publishedAt: null,
    firstPublishedAt: null,
    reeditUntil: null,
    locale: "ru",
    title: "Вечер на Оке",
    dek: "Как выглядит река в октябре",
    body: createDocument([
      createParagraph([createText("Первый абзац подачи.")], BLOCK_ONE),
      createFigure(BODY_ASSET_ID, "normal", BLOCK_TWO),
      createParagraph([createText("Второй абзац подачи.")], BLOCK_THREE)
    ]),
    sectionSlug: "culture",
    tags: ["reka", "osen"],
    coverAssetId: COVER_ID,
    media: [
      {
        id: COVER_ID,
        alt: "Река в тумане",
        caption: "Ока у Каширы",
        attribution: "Фото: Мария Иванова",
        license: "own",
        licenseNote: null
      },
      {
        id: BODY_ASSET_ID,
        alt: null,
        caption: null,
        attribution: "Фото: Мария Иванова",
        license: "cc_by",
        licenseNote: "CC BY 4.0"
      }
    ],
    ...overrides
  }
}

function createHarness(
  overrides: Partial<AiCheckStoreFixture> = {},
  onPublished = async (): Promise<void> => {},
  onDecision?: (input: {
    translationId: string
    verdict: "publish" | "reject"
    originRequestId: string | null
  }) => Promise<void>
) {
  const memory = createAiCheckMemoryStore(fixture(overrides))
  const adapter = createFakeAiCheckAdapter()
  const { logger, entries } = createLogCollector()
  let tick = 0
  const service = createAiCheckService({
    store: memory.store,
    adapter,
    logger,
    onPublished,
    onDecision,
    // Часы шагают на секунду за вызов: длительность записи становится проверяемой величиной.
    now: () => new Date(Date.UTC(2026, 8, 28, 12, 0, tick++))
  })
  return { memory, adapter, service, entries }
}

const jobInput = { jobId: "job-1", translationId: TRANSLATION_ID, revisionId: REVISION_ID, originRequestId: "req-1" }

describe("AI-адаптер проверки допустимости", () => {
  it("вид задания и коды событий уже утверждены реестрами", () => {
    expect(KNOWN_JOB_KINDS).toContain(AI_CHECK_JOB_KIND)
    expect(AUDIT_CODE_ZONES["ai.decision"]).toEqual(["moderation", "financeAndPd"])
    for (const code of ["ai.job.created", "ai.job.started", "ai.job.running", "ai.job.done", "ai.job.failed"]) {
      expect(LOG_EVENT_CODES).toContain(code)
    }
  })

  it("фикстура «отказ» даёт комментарий автору с причинами по категориям", async () => {
    const { memory, adapter, service, entries } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["illegal", "spam_ads"] })

    const outcome = await service.runCheck(jobInput)

    expect(outcome.verdict).toBe("reject")
    const process = memory.processes.get(outcome.aiProcessId)
    expect(process).toMatchObject({
      status: "completed",
      verdict: "reject",
      objectType: "ArticleTranslation",
      objectId: TRANSLATION_ID,
      revisionId: REVISION_ID,
      model: "fake-check",
      promptVersion: "fake-1",
      manipulationAttempt: false,
      adult: false
    })
    expect(process?.reasons).toEqual([
      { category: "illegal", text: expect.stringContaining("незаконный контент") },
      { category: "spam_ads", text: expect.stringContaining("спам и реклама") }
    ])
    expect(process?.evidence).toEqual([
      { category: "illegal", fragment: "Первый абзац подачи." },
      { category: "spam_ads", fragment: "Первый абзац подачи." }
    ])

    expect(memory.reviewMessages).toHaveLength(1)
    const comment = memory.reviewMessages[0]
    expect(comment).toMatchObject({ translationId: TRANSLATION_ID, kind: "ai_decision", byRole: null })
    expect(comment.text).toContain(aiCheckCategoryTitle("illegal", "ru"))
    expect(comment.text).toContain(aiCheckCategoryTitle("spam_ads", "ru"))
    expect(comment.text).not.toContain(aiCheckCategoryTitle("rights", "ru"))

    expect(memory.audit).toEqual([
      {
        action: "ai.decision",
        entityType: "ArticleTranslation",
        entityId: TRANSLATION_ID,
        diff: {
          translationId: TRANSLATION_ID,
          revisionId: REVISION_ID,
          verdict: "reject",
          reasons: ["illegal", "spam_ads"],
          promptVersion: "fake-1"
        },
        requestId: "req-1"
      }
    ])
    expect(entries.map((entry) => entry.event)).toEqual(["ai.job.started", "ai.job.running", "ai.job.done"])
    expect(entries[2]?.data).toMatchObject({ verdict: "reject", reasons: ["illegal", "spam_ads"], costMinor: 0 })
  })

  it("комментарий не раскрывает внутренние признаки проверки", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["third_party_pd"] })

    await service.runCheck(jobInput)

    const text = memory.reviewMessages[0]?.text ?? ""
    expect(text).toContain(aiCheckCategoryTitle("third_party_pd", "ru"))
    // Ни числовых порогов, ни имени модели, ни версии промпта в тексте автору нет (журнал §24.3).
    expect(text).not.toMatch(/fake-check|fake-1|\d+\s*%/)
  })

  it("вердикт «публиковать» комментария автору не создаёт", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    const outcome = await service.runCheck(jobInput)

    expect(outcome.verdict).toBe("publish")
    expect(memory.reviewMessages).toEqual([])
    expect(memory.processes.get(outcome.aiProcessId)).toMatchObject({ verdict: "publish", reasons: [], evidence: [] })
    expect(memory.audit[0]?.diff).toMatchObject({ verdict: "publish", reasons: [] })
  })

  it("без фикстуры и маркера подача публикуется: при неуверенности статья выходит", async () => {
    const { service, memory } = createHarness()

    const outcome = await service.runCheck(jobInput)

    expect(outcome.verdict).toBe("publish")
    expect(memory.reviewMessages).toEqual([])
  })

  it("маркер в тексте подачи задаёт вердикт без вмешательства в код", async () => {
    const { service, memory } = createHarness({
      body: createDocument([
        createParagraph([createText("ai-check-fixture: reject rights adult manipulation")], BLOCK_ONE)
      ])
    })

    const outcome = await service.runCheck(jobInput)

    expect(outcome.verdict).toBe("reject")
    expect(memory.processes.get(outcome.aiProcessId)).toMatchObject({
      verdict: "reject",
      adult: true,
      manipulationAttempt: true
    })
    expect(memory.audit[0]?.diff).toMatchObject({ manipulationAttempt: true, adult: true, reasons: ["rights"] })
  })

  it("разбор маркера детерминирован и не падает на лишних словах", () => {
    expect(parseFakeAiCheckMarker("нет маркера")).toBeNull()
    expect(parseFakeAiCheckMarker("ai-check-fixture: reject illegal, мусор")).toEqual({
      verdict: "reject",
      categories: ["illegal"],
      adult: false,
      manipulationAttempt: false,
      unavailable: false
    })
    expect(parseFakeAiCheckMarker("ai-check-fixture: publish")?.verdict).toBe("publish")
  })

  it("стоимость идёт только в агрегат периода и суммируется по подачам", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    const first = await service.runCheck(jobInput)
    await service.runCheck({ ...jobInput, jobId: "job-2" })

    expect(memory.aggregates).toHaveLength(1)
    expect(memory.aggregates[0]).toMatchObject({ kind: "check", processCount: 2, totalCostMinor: 0n })
    expect(memory.aggregates[0].bucketStart.toISOString()).toBe("2026-09-28T00:00:00.000Z")
    expect(memory.aggregates[0].bucketEnd.toISOString()).toBe("2026-09-29T00:00:00.000Z")
    expect(Object.keys(memory.processes.get(first.aiProcessId) ?? {}).some((key) => /cost/i.test(key))).toBe(false)
  })

  it("недоступность провайдера не даёт вердикта: PROVIDER_UNAVAILABLE ai и запись «ошибка»", async () => {
    const { memory, adapter, service, entries } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish", unavailable: true })

    await expect(service.runCheck(jobInput)).rejects.toMatchObject({
      extensions: { code: "PROVIDER_UNAVAILABLE", provider: "ai", requestId: "req-1" }
    })

    const [process] = [...memory.processes.values()]
    expect(process).toMatchObject({
      status: "failed",
      verdict: null,
      providerErrorClass: "FakeAiCheckUnavailableError"
    })
    expect(memory.reviewMessages).toEqual([])
    expect(memory.audit).toEqual([])
    expect(memory.aggregates).toEqual([])
    expect(entries.at(-1)).toMatchObject({ event: "ai.job.failed", level: "error", jobId: "job-1" })
  })

  it("повтор задания после недоступности доводит проверку до вердикта", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["age"], unavailable: true })

    await expect(service.runCheck(jobInput)).rejects.toBeInstanceOf(GraphQLError)
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["age"] })
    const outcome = await service.runCheck(jobInput)

    expect(outcome.verdict).toBe("reject")
    // Запись одна: повтор идёт по той же строке процесса, а не создаёт вторую.
    expect(memory.processes.size).toBe(1)
    expect(memory.processes.get(outcome.aiProcessId)).toMatchObject({ status: "completed", providerErrorClass: null })
    expect(memory.reviewMessages).toHaveLength(1)
  })

  it("завершённая проверка второго вердикта не выносит", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["rights"] })

    await service.runCheck(jobInput)
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })
    const repeat = await service.runCheck(jobInput)

    expect(repeat.verdict).toBeNull()
    expect(memory.processes.get(repeat.aiProcessId)).toMatchObject({ status: "completed", verdict: "reject" })
    expect(memory.reviewMessages).toHaveLength(1)
    expect(memory.audit).toHaveLength(1)
    expect(adapter.submissions).toHaveLength(1)
  })

  it("повтор завершённой публикации повторяет только инвалидацию кеша", async () => {
    const onPublished = vi
      .fn<(translationId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("cache unavailable"))
      .mockResolvedValueOnce()
    const { memory, adapter, service } = createHarness({}, onPublished)
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    await expect(service.runCheck(jobInput)).rejects.toThrow("cache unavailable")
    await expect(service.runCheck(jobInput)).resolves.toMatchObject({ verdict: null })

    expect(onPublished).toHaveBeenCalledTimes(2)
    expect(adapter.submissions).toHaveLength(1)
    expect(memory.fixture.status).toBe("published")
  })

  it("уведомление о решении (T-051) уходит один раз — повтор завершённого задания его не создаёт заново", async () => {
    const onDecision = vi.fn(async () => {})
    const { adapter, service } = createHarness({}, undefined, onDecision)
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    await service.runCheck(jobInput)
    await service.runCheck(jobInput)

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({
      translationId: TRANSLATION_ID,
      verdict: "publish",
      originRequestId: "req-1"
    })
  })

  it("вердикт «публиковать» сразу публикует ожидающую ревизию и открывает часовое окно", async () => {
    const onPublished = vi.fn<(translationId: string) => Promise<void>>().mockResolvedValue()
    const { memory, adapter, service, entries } = createHarness({}, onPublished)
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    await service.runCheck(jobInput)

    expect(memory.fixture.status).toBe("published")
    expect(memory.fixture.articleStatus).toBe("published")
    expect(memory.fixture.publishedAt?.toISOString()).toBe("2026-09-28T12:00:01.000Z")
    expect(memory.fixture.firstPublishedAt?.toISOString()).toBe("2026-09-28T12:00:01.000Z")
    expect(memory.fixture.reeditUntil?.toISOString()).toBe("2026-09-28T13:00:01.000Z")
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "translation.published", data: { translationId: TRANSLATION_ID } })
    )
    expect(onPublished).toHaveBeenCalledWith(TRANSLATION_ID)
  })

  it("вердикт «не публиковать» возвращает ожидающую ревизию в review с причинами", async () => {
    const { memory, adapter, service } = createHarness()
    adapter.setFixture(TRANSLATION_ID, { verdict: "reject", categories: ["rights"] })

    await service.runCheck(jobInput)

    expect(memory.fixture.status).toBe("review")
    expect(memory.fixture.articleStatus).toBe("review")
    expect(memory.reviewMessages).toHaveLength(1)
  })

  it("поздний результат после withdraw не меняет черновик и не публикует событие", async () => {
    const { memory, adapter, service, entries } = createHarness({ status: "draft", articleStatus: "draft" })
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    await service.runCheck(jobInput)

    expect(memory.fixture.status).toBe("draft")
    expect(memory.fixture.articleStatus).toBe("draft")
    expect(entries.some((entry) => entry.event === "translation.published")).toBe(false)
  })

  it("результат старой ревизии не применяется к новой подаче", async () => {
    const { memory, adapter, service, entries } = createHarness({ latestRevisionId: "revision-2" })
    adapter.setFixture(TRANSLATION_ID, { verdict: "publish" })

    await service.runCheck(jobInput)

    expect(memory.fixture.status).toBe("ai_check")
    expect(entries.some((entry) => entry.event === "translation.published")).toBe(false)
  })

  it("несобираемая подача не выдаётся за недоступность провайдера", async () => {
    const { memory, service, entries } = createHarness()

    await expect(service.runCheck({ ...jobInput, revisionId: "revision-unknown" })).rejects.toThrow(
      "Article revision not found for this translation"
    )

    const [process] = [...memory.processes.values()]
    expect(process).toMatchObject({ status: "failed", providerErrorClass: "AiCheckSourceMissingError" })
    expect(entries.at(-1)).toMatchObject({ event: "ai.job.failed" })
  })

  it("параметры задания проверяются по форме", () => {
    expect(parseAiCheckJobParameters({ translationId: "t", revisionId: "r" })).toEqual({
      translationId: "t",
      revisionId: "r"
    })
    expect(() => parseAiCheckJobParameters(null)).toThrow(/translationId/)
    expect(() => parseAiCheckJobParameters({ translationId: "t" })).toThrow(/revisionId/)
  })

  it("реализация выбирается окружением: fake в разработке, недоступность в production", async () => {
    expect(createAiCheckAdapterFromEnv({}).name).toBe("fake")
    expect(createAiCheckAdapterFromEnv({ NODE_ENV: "production" }).name).toBe("unavailable")
    expect(createAiCheckAdapterFromEnv({ AI_CHECK_ADAPTER: "fake" }).name).toBe("fake")
    expect(() => createAiCheckAdapterFromEnv({ NODE_ENV: "production", AI_CHECK_ADAPTER: "fake" })).toThrow(
      /not allowed in production/
    )
    expect(() => createAiCheckAdapterFromEnv({ AI_CHECK_ADAPTER: "real" })).toThrow(/awaits the owner's approval/)
    expect(() => createAiCheckAdapterFromEnv({ AI_CHECK_ADAPTER: "yandexgpt" })).toThrow(/Unknown AI_CHECK_ADAPTER/)
  })

  it("ненастроенный провайдер вердикта не выдумывает", async () => {
    const adapter = createUnavailableAiCheckAdapter()

    await expect(
      adapter.check({
        translationId: TRANSLATION_ID,
        revisionId: REVISION_ID,
        locale: "ru",
        title: "Вечер на Оке",
        dek: null,
        blocks: "Текст",
        sectionSlug: null,
        tags: [],
        images: [],
        adultMarkedByAuthor: false
      })
    ).rejects.toThrow("AI check provider is not configured")
  })
})
