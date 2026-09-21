import { describe, expect, it } from "vitest"
import {
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  contactFailure,
  formatRetryAfter,
  hasContactQuery,
  parseContactPath,
  parseContactRequestId,
  parseContactTopic,
  validateContactDraft
} from "../app/utils/contactForm"

// Правила страницы «Письмо в редакцию» (`docs/spec/20-public/contact.md` §3, §4, §8).

const draft = (overrides: Partial<Parameters<typeof validateContactDraft>[0]> = {}) => ({
  topic: "general" as const,
  email: "guest@example.test",
  message: "Здравствуйте, у меня вопрос о журнале.",
  acceptPrivacy: true,
  ...overrides
})

describe("query-параметры", () => {
  it("тема: без параметра — общий вопрос, неизвестная — «другое»", () => {
    expect(parseContactTopic(undefined)).toBe("general")
    expect(parseContactTopic("broken_link")).toBe("broken_link")
    expect(parseContactTopic(["refund", "general"])).toBe("refund")
    expect(parseContactTopic("privacy")).toBe("other")
  })

  it("путь: только адрес сайта и без query", () => {
    expect(parseContactPath("/culture/essay?utm=mail")).toBe("/culture/essay")
    expect(parseContactPath("https://evil.test/")).toBe("")
    expect(parseContactPath("//evil.test/x")).toBe("")
    expect(parseContactPath(undefined)).toBe("")
  })

  it("requestId: только допустимый вид", () => {
    expect(parseContactRequestId("t058-request-id")).toBe("t058-request-id")
    expect(parseContactRequestId("<script>")).toBe("")
  })

  it("адрес с параметрами не индексируется", () => {
    expect(hasContactQuery({})).toBe(false)
    expect(hasContactQuery({ topic: "refund" })).toBe(true)
  })
})

describe("проверка полей", () => {
  it("гость без ошибок", () => {
    expect(validateContactDraft(draft(), "guest")).toEqual({})
  })

  it("гость: адрес, формат и согласие", () => {
    expect(validateContactDraft(draft({ email: "", acceptPrivacy: false }), "guest")).toEqual({
      email: "required",
      acceptPrivacy: "required"
    })
    expect(validateContactDraft(draft({ email: "no-at-sign" }), "guest")).toEqual({ email: "email" })
  })

  it("аккаунт: адрес и согласие не спрашиваются", () => {
    expect(validateContactDraft(draft({ email: "", acceptPrivacy: false }), "account")).toEqual({})
  })

  it("границы длины текста", () => {
    expect(validateContactDraft(draft({ message: "  " }), "guest")).toEqual({ message: "required" })
    expect(validateContactDraft(draft({ message: "я".repeat(CONTACT_MESSAGE_MIN - 1) }), "guest")).toEqual({
      message: "tooShort"
    })
    expect(validateContactDraft(draft({ message: "я".repeat(CONTACT_MESSAGE_MIN) }), "guest")).toEqual({})
    expect(validateContactDraft(draft({ message: "я".repeat(CONTACT_MESSAGE_MAX + 1) }), "guest")).toEqual({
      message: "tooLong"
    })
  })
})

describe("ответ API", () => {
  it("лимит — с временем до следующей попытки", () => {
    expect(contactFailure([{ extensions: { code: "RATE_LIMITED", retryAfter: 125 } }])).toEqual({
      kind: "rateLimited",
      retryAfter: 125
    })
  })

  it("ошибка поля — у поля, без кода запроса", () => {
    expect(contactFailure([{ extensions: { code: "VALIDATION_ERROR", field: "email", requestId: "r" } }])).toEqual({
      kind: "field",
      field: "email"
    })
  })

  it("технический сбой — с кодом запроса", () => {
    expect(contactFailure([{ extensions: { code: "INTERNAL_ERROR", requestId: "req-1" } }])).toEqual({
      kind: "failed",
      requestId: "req-1"
    })
    expect(contactFailure(undefined)).toEqual({ kind: "failed", requestId: null })
  })

  it("таймер лимита", () => {
    expect(formatRetryAfter(125)).toBe("2:05")
    expect(formatRetryAfter(-3)).toBe("0:00")
  })
})
