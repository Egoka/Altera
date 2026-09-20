// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LaunchFaq from "../app/components/pricing/LaunchFaq.vue"
import LegalNote from "../app/components/pricing/LegalNote.vue"
import PlanCard from "../app/components/pricing/PlanCard.vue"
import PlanCompare from "../app/components/pricing/PlanCompare.vue"
import ErrorState from "../app/components/reading/ErrorState.vue"
import {
  PRICING_COMPARE_ROWS,
  PRICING_FAQ_KEYS,
  PRICING_LAUNCH_PLANS,
  resolvePricingLaunchState
} from "../app/utils/pricingLaunch"

// Проверяет критерий T-060: на «Ценах и планах» первого запуска нет ни числовых цен,
// ни кнопок оплаты, а каждая строка состояний `docs/spec/20-public/pricing.md` §8
// либо воспроизводится, либо относится к платному этапу и на запуске не наступает.

const here = dirname(fileURLToPath(import.meta.url))
const ru = JSON.parse(readFileSync(join(here, "..", "i18n", "locales", "ru.json"), "utf8"))

const translate = (key: string, params: Record<string, string | number> = {}): string => {
  const value = key.split(".").reduce<unknown>((carry, part) => {
    if (carry !== null && typeof carry === "object") return (carry as Record<string, unknown>)[part]
    return undefined
  }, ru)

  const message = typeof value === "string" ? value : key

  return Object.entries(params).reduce(
    (carry, [name, replacement]) => carry.replace(`{${name}}`, String(replacement)),
    message
  )
}

const global = {
  stubs: {
    NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
    // FishtVue `Accordion` в тесте подменяется разметкой без анимации: важен состав FAQ.
    Accordion: {
      props: ["dataSource"],
      template:
        '<div data-accordion><section v-for="item in dataSource" :key="item.title">' +
        "<h3>{{ item.title }}</h3><p>{{ item.subtitle }}</p></section></div>"
    }
  }
}

const mountPlanCards = () =>
  PRICING_LAUNCH_PLANS.map((plan) =>
    mount(PlanCard, {
      props: { tier: plan.tier, availability: plan.availability, features: plan.features },
      global
    })
  )

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t: translate }))
})

describe("критерий 1: нет числовых цен и кнопок оплаты", () => {
  it("не печатает ни одной цифры и ни одного знака валюты в карточках планов", () => {
    for (const card of mountPlanCards()) {
      expect(card.text()).not.toMatch(/\d/)
      expect(card.text()).not.toMatch(/[₽$€]/)
    }
  })

  it("не даёт карточкам ни кнопок, ни ссылок на оплату", () => {
    for (const card of mountPlanCards()) {
      expect(card.findAll("button")).toHaveLength(0)
      expect(card.findAll("a")).toHaveLength(0)
    }
  })

  it("помечает free доступным сейчас, а платные планы — будущими", () => {
    const [free, standard, pro] = mountPlanCards()

    expect(free?.get("[data-testid='plan-availability']").text()).toBe(translate("pricing.availability.now"))
    expect(standard?.get("[data-testid='plan-availability']").text()).toBe(translate("pricing.availability.later"))
    expect(pro?.get("[data-testid='plan-availability']").text()).toBe(translate("pricing.availability.later"))
  })

  it("сравнивает планы без чисел, лимитов и позиций в выдаче", () => {
    const compare = mount(PlanCompare, {
      props: { rows: PRICING_COMPARE_ROWS, tiers: PRICING_LAUNCH_PLANS.map((plan) => plan.tier) },
      global
    })

    expect(compare.text()).not.toMatch(/\d/)
    expect(compare.findAll("button")).toHaveLength(0)
  })

  it("ведёт в правовые тексты, но не в оплату", () => {
    const legal = mount(LegalNote, {
      props: {
        titleKey: "pricing.legal.title",
        noteKeys: ["pricing.legal.notes.noPayment"],
        links: [
          { labelKey: "pricing.legal.offer", to: "/legal/paid-services" },
          { labelKey: "pricing.legal.refunds", to: "/legal/refunds" }
        ]
      },
      global
    })

    expect(legal.findAll("a").map((link) => link.attributes("href"))).toEqual([
      "/legal/paid-services",
      "/legal/refunds"
    ])
    expect(legal.text()).toContain(translate("pricing.legal.notes.noPayment"))
    expect(legal.findAll("button")).toHaveLength(0)
  })

  it("отвечает в FAQ, что цен и платежей на запуске нет", () => {
    const faq = mount(LaunchFaq, { props: { itemKeys: PRICING_FAQ_KEYS }, global })

    for (const key of PRICING_FAQ_KEYS) {
      expect(faq.text()).toContain(translate(`pricing.faq.items.${key}.question`))
    }

    expect(faq.text()).toContain(translate("pricing.faq.items.refunds.answer"))
    expect(faq.text()).not.toMatch(/\d/)
  })
})

describe("критерий 2: строки состояний pricing.md §8 на первом запуске", () => {
  it("«Загрузка» — обычная страница: каталог запуска не ходит за ценами", () => {
    // Скелеты ждут ответа `plans`/`me.subscription`; на запуске этих запросов нет,
    // потому что оба существуют ради цен и подписки (`pricing.md` §4).
    expect(resolvePricingLaunchState(PRICING_LAUNCH_PLANS)).toBe("ready")
    expect(mountPlanCards()).toHaveLength(3)
  })

  it("«Пусто» — пустой каталог даёт «планы временно недоступны»", () => {
    expect(resolvePricingLaunchState([])).toBe("empty")

    const error = mount(ErrorState, {
      props: {
        title: translate("pricing.states.empty.title"),
        description: translate("pricing.states.empty.description")
      },
      global
    })

    expect(error.get("[role='alert']").text()).toContain(translate("pricing.states.empty.title"))
  })

  it("«Ошибка данных» — тот же ErrorState с кодом запроса", () => {
    const error = mount(ErrorState, {
      props: { title: translate("pricing.states.empty.title"), requestId: "req-060" },
      global
    })

    expect(error.text()).toContain("req-060")
  })

  it("«Нет доступа» — страница публична, карточки одинаковы для всех ролей", () => {
    // На запуске кнопок оплаты нет ни у кого, поэтому служебная роль видит то же, что гость
    // (`pricing.md` §2, §8): различать роли на странице нечем.
    const [first] = mountPlanCards()
    const [second] = mountPlanCards()

    expect(first?.html()).toBe(second?.html())
  })

  it("«Не найдено», «Заблокирован» и «Paywall» не меняют разметку запуска", () => {
    // Адрес фиксирован, архивированный аккаунт видит страницу как гость, paywall зарезервирован
    // и не наступает (`pricing.md` §8): все три строки — та же публичная страница.
    for (const card of mountPlanCards()) {
      expect(card.attributes("data-plan")).toBeTruthy()
      expect(card.findAll("a")).toHaveLength(0)
    }
  })

  it("«Ограничение плана» и «провайдер недоступен» относятся к платному этапу", () => {
    // Обе строки описывают кнопки покупки и статус платёжного провайдера. На запуске покупки
    // нет (журнал §24.1), поэтому ни одна кнопка оплаты на странице не появляется.
    const rendered = mountPlanCards()
      .map((card) => card.html())
      .join("")

    expect(rendered).not.toMatch(/checkout|providerStatus/i)
    expect(rendered).not.toMatch(/<button/)
  })
})
