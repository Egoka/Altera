import { describe, expect, it } from "vitest"
import userResolver from "../src/graphql/user/resolver"
import { EMPTY_ACCOUNT_NAME, publicDisplayName } from "../src/visibility/display-name"

// Имя аккаунта не выводится из e-mail (ADR-0018 п. 3, журнал §25.4, T-126):
// пока пользователь не задал имя, публичные ответы подписываются хэндлом.

describe("публичное имя аккаунта", () => {
  it("отдаёт заданное имя как есть", () => {
    expect(publicDisplayName("Вера Орлова", "vera")).toBe("Вера Орлова")
  })

  it("подставляет хэндл вместо пустого имени и строки из пробелов", () => {
    expect(publicDisplayName(EMPTY_ACCOUNT_NAME, "vera")).toBe("vera")
    expect(publicDisplayName("   ", "vera")).toBe("vera")
    expect(publicDisplayName(null, "vera")).toBe("vera")
  })

  it("новый аккаунт заводится без имени", () => {
    expect(EMPTY_ACCOUNT_NAME).toBe("")
  })
})

describe("поле name публичного типа User", () => {
  const name = (parent: { name: string | null; handle: string }) =>
    userResolver.User.name(parent as never as { name: string | null; handle: string })

  it("страница автора по хэндлу показывает хэндл, а не пустую строку", () => {
    expect(name({ name: "", handle: "ivan-1a2b" })).toBe("ivan-1a2b")
  })

  it("не показывает адрес почты вместо имени", () => {
    // Регистрация больше не пишет локальную часть адреса в имя, поэтому подставить
    // «ivan.petrov» публичному ответу неоткуда.
    expect(name({ name: "", handle: "ivan-1a2b" })).not.toContain("@")
    expect(name({ name: "", handle: "ivan-1a2b" })).not.toBe("ivan.petrov")
  })

  it("заданное имя оставляет без изменений", () => {
    expect(name({ name: "Вера Орлова", handle: "vera" })).toBe("Вера Орлова")
  })
})
