# План: T-092 — Ядро дизайн-системы: токены, палитра, типографика, отступы, тема

- **Задача**: T-092 / ALTE-22
- **Исполнитель стадии дизайна**: Altera — дизайнер
- **Baseline commit**: `a39387e089253c5b2918db4329887a51a0e71377`
- **Ветка**: `web/t-092-design-tokens-theme`
- **Worktree**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t092-design-tokens`
- **Дата**: 2026-09-15

---

## 1. Что делаем и что не трогаем

**Входит в T-092:**

- `web/app/assets/css/main.css` — токены, палитра, типографика, схема отступов
- `web/app/composables/useTheme.ts` — удаляем (заменяет `@nuxtjs/color-mode`)
- `web/app/components/functional/ThemeToggle.vue` — переписываем на `useColorMode()`
- `web/app/components/demo/` — удаляем папку
- `web/app/components/article/featured.vue` — удаляем (мёртвый код по 06-design-system.md §11)

**Не входит (T-093, T-094):**

- Остальные компоненты (`article/base.vue`, `article/large.vue` и т.д.)
- Страницы
- Конфигурация роутера и middleware

---

## 2. Проектные решения

### 2.1. Палитра — одна семантическая

**Проблема**: сейчас `primary` и `secondary` идентичны (одни и те же значения), `success-500` — чужеродный цвет (`#22d3ee`), токены `inter/poppins/roboto/open-sans` объявлены без подключённых шрифтов.

**Решение** (по `docs/vision/06-design-system.md §3`):

Удалить дублирующий `--color-secondary-*`. Ввести семантические токены поверх существующих числовых:

| Токен               | Назначение                  | Светлая                  | Тёмная    |
| ------------------- | --------------------------- | ------------------------ | --------- |
| `--color-paper`     | фон страницы                | `#faf9f7` (тёплый белый) | `#111111` |
| `--color-ink`       | основной текст              | `#111111`                | `#f5f4f0` |
| `--color-ink-muted` | подписи, даты, кикеры       | `#6b6b6b`                | `#9ca3af` |
| `--color-accent`    | акцент — текущий orange-red | `#ff5a1f`                | `#ff7847` |
| `--color-rule`      | линейки, разделители        | `#e5e3de`                | `#2a2a2a` |
| `--color-surface`   | карточки приложения, формы  | `#ffffff`                | `#1a1a1a` |

Числовая шкала `--color-primary-*` остаётся как source-палитра (на неё опирается `--color-accent`). `--color-secondary-*` — удаляется. `--color-accent-*` как шкала остаётся, но выравнивается: убираем `success-500: #22d3ee` (чужеродный голубой), заменяем на `#22c55e`.

`--color-success/warning/error/neutral` — оставляем, это токены состояний приложения (нужны FishtVue).

Удаляем `--font-inter/poppins/roboto/open-sans` (нет подключённых файлов шрифтов, `font-sans` Tailwind работает без них).

### 2.2. Типографика — включаем `@layer base`

**Проблема**: весь блок `@layer base` с базовой типографикой закомментирован (AC-1 задачи). Там также есть неверные ссылки на `body.dark` вместо `html.dark`.

**Решение**:

Раскомментировать и переписать `@layer base` по схеме из `docs/vision/06-design-system.md §3`:

```css
@layer base {
  html {
    font-family: theme(fontFamily.sans);
    line-height: 1.6;
    background-color: var(--color-paper);
    color: var(--color-ink);
  }

  h1 {
    font-family: var(--font-waterway); /* Display */
  }
  h2 {
    font-family: var(--font-waterway);
  }
  h3,
  h4,
  h5,
  h6 {
    font-family: var(--font-garamond-libre);
  }

  /* Мера текста — prose */
  .prose {
    font-family: var(--font-garamond-libre);
    font-size: 1.125rem;
    line-height: 1.7;
    max-width: 65ch; /* ~65-75 знаков */
  }
}
```

Базовые размеры и интерлиньяж соответствуют §3: `1,125–1,25 rem`, `1,6–1,7`.

### 2.3. Тёмная тема — один механизм

**Проблема** (по `00-reality-check.md §1`):

- `@nuxtjs/color-mode` настроен на `html.dark` (FishtVue настроен на `html.dark`)
- `main.css` объявляет `body.dark` (другой селектор)
- `useTheme.ts` добавляет/убирает класс `dark` на `html` — дублирует `@nuxtjs/color-mode`
- `ThemeToggle.vue` использует `useTheme` вместо `useColorMode`

**Решение**:

1. В `main.css`: убрать `@layer base { body.dark { … } }`, заменить на `@custom-variant dark (&:where(.dark, .dark *))` — уже есть, но нужно убедиться что везде используется `html.dark`.
2. Тёмную палитру объявлять через `.dark` селектор на `:root` или `html`:
   ```css
   @layer base {
     .dark {
       --color-paper: #111111;
       --color-ink: #f5f4f0;
       /* … остальные семантические токены */
     }
   }
   ```
3. Удалить `useTheme.ts`.
4. Переписать `ThemeToggle.vue` на `useColorMode()` из `@nuxtjs/color-mode`.

### 2.4. Схема отступов — единая

**Проблема**: шесть разных схем горизонтальных отступов (по `06-design-system.md §1`).

**Решение**: зафиксировать токены-схему в `@theme`:

```css
/* Контейнер и отступы (по 06-design-system.md §3) */
--container-max: 80rem; /* max-w-7xl = 1280px */
--container-prose: 48rem; /* max-w-3xl ≈ 768px — мера текста */
--spacing-page-x: 1rem; /* px-4 */
--spacing-page-x-sm: 1.5rem; /* sm:px-6 */
--spacing-page-x-lg: 2rem; /* lg:px-8 */
```

Компоненты используют эти токены через классы `px-4 sm:px-6 lg:px-8` (стандартные Tailwind utility, совпадающие с токенами). Рефактор компонентов — T-093/T-094.

---

## 3. Затрагиваемые файлы

| Файл                                            | Действие                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web/app/assets/css/main.css`                   | переписать: убрать `secondary-*`, исправить `success-500`, удалить `font-inter/poppins/roboto/open-sans`, раскомментировать и переписать `@layer base`, заменить `body.dark` на `.dark :root`, добавить семантические токены, добавить токены отступов |
| `web/app/composables/useTheme.ts`               | удалить                                                                                                                                                                                                                                                |
| `web/app/components/functional/ThemeToggle.vue` | переписать на `useColorMode()`                                                                                                                                                                                                                         |
| `web/app/components/demo/`                      | удалить папку                                                                                                                                                                                                                                          |
| `web/app/components/article/featured.vue`       | удалить                                                                                                                                                                                                                                                |

---

## 4. Критерии готовности (из задачи)

1. **AC-1**: `grep -n '/\*' web/app/assets/css/main.css` — нет закомментированной базовой типографики в `@layer base`.
2. **AC-2**: Playwright — тема переключается одним механизмом (`useColorMode`).

---

## 5. Порядок реализации (для разработчика)

1. Обновить `web/app/assets/css/main.css`:
   - Удалить `--color-secondary-*`
   - Исправить `--color-success-500: #22c55e` (было `#22d3ee`)
   - Удалить `--font-inter/poppins/roboto/open-sans`
   - Добавить семантические токены (`--color-paper`, `--color-ink`, `--color-ink-muted`, `--color-accent`, `--color-rule`, `--color-surface`)
   - Добавить токены схемы отступов
   - Раскомментировать и переписать `@layer base` (базовая типографика, `html` background/color по семантическим токенам)
   - Заменить `body.dark { --color-primary-* }` на `.dark { --color-paper: ...; --color-ink: ... }` (семантические оверрайды)
2. Удалить `web/app/composables/useTheme.ts`
3. Переписать `web/app/components/functional/ThemeToggle.vue` → `useColorMode()`
4. Удалить `web/app/components/demo/`
5. Удалить `web/app/components/article/featured.vue`
6. Проверить: `pnpm -C web typecheck`, `pnpm lint`, `pnpm test`
7. Проверить AC-1: `grep -n '/\*' web/app/assets/css/main.css | grep -v "^.*@font-face"` — нет закомментированных блоков типографики
8. Написать/запустить Playwright тест AC-2

---

## 6. Ограничения и не-scope

- Значения цветовых токенов (`--color-paper`, `--color-ink` и т.д.) выбираются при доводке; в плане указаны направления (тёплый белый / почти чёрный), не финальные hex. Контраст text/bg ≥ 4,5:1 (AA).
- Числовые параметры медиа (breakpoints, srcset) — не задаются в этой задаче.
- Компоненты `article/base.vue`, `article/large.vue` и т.д. — T-093/T-094, не трогаем.
- `process.client` в `useBreakpoint.ts` — отдельная задача, не входит.
