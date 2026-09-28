import { describe, expect, it } from "vitest"
import { ABOUT_NOT_WORKING_ANCHOR, splitAboutText } from "../app/utils/aboutText"
import { REPORT_CONTACT_TOPIC, CONTACT_TOPICS, parseContactPath, parseContactTopic } from "../app/utils/contactForm"

/**
 * T-118: разбор текста владельца на зону «что ещё не работает» и остальной текст
 * (`docs/spec/20-public/about.md` §5 зона 6, журнал §37 п. 1). Страница и браузерные сценарии —
 * `e2e/118-about-not-working-report.spec.ts`.
 */

const withList = [
  '<h2 id="status">Статус проекта</h2><p>Журнал развивается.</p>',
  `<h2 id="${ABOUT_NOT_WORKING_ANCHOR}">Что ещё не работает</h2>`,
  '<ul><li>Редактор статьи</li><li>Почта уходит <a href="/legal/terms">в вывод</a></li><li>  </li></ul>',
  '<h2 id="rights">Права</h2><p>Права у авторов.</p>'
].join("")

describe("splitAboutText", () => {
  it("выносит раздел с якорем в зону и убирает его из текста", () => {
    const { notWorking, body } = splitAboutText(withList)

    expect(notWorking?.title).toBe("Что ещё не работает")
    expect(notWorking?.items).toEqual(["Редактор статьи", 'Почта уходит <a href="/legal/terms">в вывод</a>'])
    expect(body).toContain("Статус проекта")
    expect(body).toContain("Права у авторов.")
    expect(body).not.toContain("Редактор статьи")
  })

  it("без раздела возвращает текст целиком", () => {
    const html = '<h2 id="status">Статус проекта</h2><p>Журнал развивается.</p>'

    expect(splitAboutText(html)).toEqual({ notWorking: null, body: html })
  })

  it("раздел без списка читается по абзацам", () => {
    const html = `<h2 id="${ABOUT_NOT_WORKING_ANCHOR}">Чего ещё нет</h2><p>Редактора статьи.</p><p>Почты.</p>`

    expect(splitAboutText(html).notWorking).toEqual({
      title: "Чего ещё нет",
      items: ["Редактора статьи.", "Почты."]
    })
  })

  it("пустой раздел не создаёт зону: текст ничего не теряет", () => {
    const html = `<h2 id="${ABOUT_NOT_WORKING_ANCHOR}">Что ещё не работает</h2><ul><li></li></ul>`

    expect(splitAboutText(html)).toEqual({ notWorking: null, body: html })
  })

  it("пустой текст зоны не даёт", () => {
    expect(splitAboutText("")).toEqual({ notWorking: null, body: "" })
  })
})

describe("тема обращения кнопки «Пожаловаться»", () => {
  it("тема из справочника и путь материала доходят до формы", () => {
    expect(CONTACT_TOPICS).toContain(REPORT_CONTACT_TOPIC)
    expect(parseContactTopic(REPORT_CONTACT_TOPIC)).toBe(REPORT_CONTACT_TOPIC)
    expect(parseContactPath("/culture/gorod-slushaet-more")).toBe("/culture/gorod-slushaet-more")
  })
})
