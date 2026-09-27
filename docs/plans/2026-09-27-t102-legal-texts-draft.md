# План T-102: черновики юридических текстов

- **Задача**: `docs/backlog/tasks/T-102-legal-texts-content.md`; native issue ALTE-129
- **Эпик**: E-16 «Юридические тексты и согласия»
- **Baseline `origin/app`**: `0b710cb8daf9a806d735522f1ffdcd071d46c58c`
- **Ветка / worktree**: `docs/t102-legal-texts-draft`, `.worktrees/t102-legal-texts`
- **Роль**: редактор и бренд-стратег

## Источники

- Журнал решений: §24.2, §24.3, §32, §37 (пп. 3–4), §39
- Спецификации: `docs/spec/90-business-model/legal-152-54.md`, `docs/spec/20-public/legal-terms.md`,
  `docs/spec/20-public/legal-privacy.md`, `docs/spec/20-public/legal-content-rules.md`,
  `docs/spec/20-public/legal-license.md`
- ADR: ADR-0008, ADR-0011, ADR-0028, ADR-0043

## Границы

Входит: черновики четырёх документов (ru + en) для первого запуска.  
Не входит: условия платных услуг и возвраты (F-01), критерии AI-проверки (T-113),
публикация (выполняет владелец через `/admin/legal`).

## Артефакты

| Файл | Описание |
|---|---|
| `docs/legal/ru/terms.md` | Оферта (пользовательское соглашение), ru |
| `docs/legal/ru/privacy.md` | Политика обработки ПД с разделом #cookies, ru |
| `docs/legal/ru/content-rules.md` | Правила публикации (6 категорий), ru |
| `docs/legal/ru/license.md` | Лицензия на контент (запрет обучения ИИ §24.2), ru |
| `docs/legal/en/terms.md` | Terms of Service, en |
| `docs/legal/en/privacy.md` | Privacy Policy с разделом #cookies, en |
| `docs/legal/en/content-rules.md` | Publication Rules, en |
| `docs/legal/en/license.md` | Content License (AI training prohibition), en |

## Шаги

1. Прочитать задачу и источники (журнал §39, §24.2, §32, §37; спецификации; ADR).
2. Написать черновики четырёх документов на русском.
3. Перевести на английский (равнозначные версии, §37 п. 4).
4. Зафиксировать в коммите, создать PR в app.
5. Передать на независимое ревью и юридическую проверку (цепочка §39).
