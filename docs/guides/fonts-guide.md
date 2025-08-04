# Руководство по шрифтам

## Настроенные шрифты

В проекте настроены следующие шрифты:

### 1. Inter (Google Fonts)
- **Назначение**: Основной текст, интерфейс
- **Вес**: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold)
- **Стили**: Normal, Italic
- **CSS переменная**: `var(--font-inter)`
- **Tailwind класс**: `text-inter`

### 2. Poppins (Google Fonts)
- **Назначение**: Кнопки, акценты
- **Вес**: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold)
- **Стили**: Normal, Italic
- **CSS переменная**: `var(--font-poppins)`
- **Tailwind класс**: `text-poppins`

### 3. Roboto (Google Fonts)
- **Назначение**: Цитаты, дополнительный текст
- **Вес**: 300 (Light), 400 (Regular), 500 (Medium), 700 (Bold)
- **Стили**: Normal, Italic
- **CSS переменная**: `var(--font-roboto)`
- **Tailwind класс**: `text-roboto`

### 4. Open Sans (Google Fonts)
- **Назначение**: Альтернативный основной шрифт
- **Вес**: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold)
- **Стили**: Normal, Italic
- **CSS переменная**: `var(--font-open-sans)`
- **Tailwind класс**: `text-open-sans`

### 5. Georgia (Системный шрифт)
- **Назначение**: Заголовки, акценты (временно)
- **CSS переменная**: `var(--font-bergamasco)`
- **Tailwind класс**: `text-bergamasco`

## Использование в Tailwind CSS

### CSS переменные
```css
/* В CSS */
.my-heading {
  font-family: var(--font-bergamasco);
}

.my-text {
  font-family: var(--font-inter);
}
```

### Tailwind классы
```html
<!-- Заголовки -->
<h1 class="text-bergamasco font-bold text-4xl">Заголовок</h1>

<!-- Основной текст -->
<p class="text-inter text-lg">Основной текст</p>

<!-- Кнопки -->
<button class="text-poppins font-semibold">Кнопка</button>

<!-- Цитаты -->
<blockquote class="text-roboto font-medium italic">Цитата</blockquote>
```

## Рекомендации по использованию

### Заголовки
- Используйте **Georgia** (временно) для заголовков H1-H6
- Вес: 700 (Bold) для главных заголовков
- Вес: 600 (Semibold) для подзаголовков

### Основной текст
- Используйте **Inter** для основного текста
- Вес: 400 (Regular) для обычного текста
- Вес: 500 (Medium) для выделенного текста

### Кнопки и действия
- Используйте **Poppins** для кнопок
- Вес: 600 (Semibold) для основных кнопок
- Вес: 500 (Medium) для вторичных кнопок

### Навигация
- Используйте **Inter** для навигации
- Вес: 500 (Medium) для активных элементов
- Вес: 400 (Regular) для обычных элементов

### Цитаты и выделения
- Используйте **Roboto** для цитат
- Вес: 400 (Regular) с italic для цитат
- Вес: 500 (Medium) для выделений

## Примеры компонентов

### Заголовок статьи
```html
<article>
  <h1 class="text-bergamasco font-bold text-4xl mb-4">Название статьи</h1>
  <p class="text-inter text-lg leading-relaxed">
    Основной текст статьи с хорошей читаемостью...
  </p>
</article>
```

### Навигационное меню
```html
<nav class="text-inter font-medium space-x-6">
  <a href="#" class="hover:text-secondary-600">Главная</a>
  <a href="#" class="hover:text-secondary-600">Статьи</a>
  <a href="#" class="hover:text-secondary-600">О нас</a>
</nav>
```

### Кнопка действия
```html
<button class="text-poppins font-semibold bg-secondary-500 text-white px-6 py-3 rounded-lg hover:bg-secondary-600 transition-colors">
  Отправить
</button>
```

### Цитата
```html
<blockquote class="text-roboto font-medium text-lg italic bg-neutral-100 p-6 rounded-lg">
  "Важная цитата или выделенная информация"
</blockquote>
```

## Демонстрация

Для просмотра всех шрифтов в действии перейдите на страницу `/fonts-showcase`.

## Добавление новых шрифтов

1. Добавьте шрифт в конфигурацию `nuxt.config.ts`:
```typescript
fonts: {
  families: [
    {
      name: 'New Font',
      weights: [400, 700],
      styles: ['normal', 'italic']
    }
  ]
}
```

2. Добавьте CSS переменную в `main.css`:
```css
@theme {
  --font-new-font: 'New Font', system-ui, sans-serif;
}
```

3. Создайте Tailwind класс:
```css
.text-new-font {
  font-family: var(--font-new-font);
}
```

## Добавление локальных шрифтов

Для добавления локальных шрифтов (например, Bergamasco):

1. Поместите файлы шрифтов в папку `web/app/assets/fonts/`
2. Добавьте `@font-face` декларации в `main.css`
3. Обновите CSS переменные в `@theme`

Пример для Bergamasco:
```css
@font-face {
  font-family: 'Bergamasco';
  src: url('~/assets/fonts/Bergamasco/Bergamasco-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@theme {
  --font-bergamasco: 'Bergamasco', 'Georgia', 'Times New Roman', serif;
}
``` 