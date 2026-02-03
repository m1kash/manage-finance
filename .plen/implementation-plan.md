### Implementation Plan: Finance Google Integration

This plan outlines the steps and file structure required to build a web form that captures financial data and sends it to a Google Sheet.

#### 1. Project Initialization
- [ ] Initialize a Vite project with TypeScript support.
- [ ] Install and configure Tailwind CSS for styling.
- [ ] Set up ESLint for code quality.

#### 2. Google Apps Script (`Code.gs`)
This file will handle the backend logic within the Google Sheets environment.
- [ ] `doGet()`:
  - [ ] Serve the HTML interface.
- [ ] `getCategories()`:
  - [ ] Read categories from Column A of the spreadsheet.
  - [ ] Return a unique list of categories (e.g., Продукты, Такси, etc.).
- [ ] `processForm(data)`:
  - [ ] Receive `category`, `date`, and `sum`.
  - [ ] If `date` not provided, use today in the local timezone.
  - [ ] Find the correct row (Category) and column (Date) to insert the `sum`.
  - [ ] If exact cell matching is complex, append data to a "Transactions" sheet for easier processing.

#### 3. Frontend Development (`index.html`)
- [ ] Create a responsive container using Tailwind CSS.
- [ ] Category Field: A `<select>` dropdown populated dynamically.
- [ ] Date Field: An `<input type="date">` that defaults to the current local date.
- [ ] Sum Field: An `<input type="number">` with validation.
- [ ] Submit Button: With loading states.

#### 4. Frontend Logic (`src/main.ts`)
- [ ] Initialization: Call `google.script.run.getCategories()` on page load to populate the dropdown.
- [ ] Date Logic: Use `new Date()` with local timezone to set the default date (formatted as `YYYY-MM-DD`).
- [ ] Form Submission:
  - [ ] Validate required fields (`Category`, `Sum`).
  - [ ] Use `google.script.run.withSuccessHandler/withFailureHandler` to call `processForm`.
  - [ ] Show success/error notifications using Tailwind-styled alerts.

#### 5. Build and Deployment
- [ ] Configure `vite-plugin-singlefile` to bundle the entire frontend into a single `index.html` suitable for Google Apps Script.
- [ ] Deploy the script as a Web App with "Anyone with access" permissions.

---

### Extracted Categories (from Image)
The following categories will be used as the initial data source:
- [ ] Продукты
- [ ] Для Гигиены
- [ ] Стрижка
- [ ] Аптека
- [ ] Свиданки
- [ ] Кофе (Напитки)
- [ ] Кафе
- [ ] Кальян
- [ ] Развлечение
- [ ] Казино
- [ ] Вход в клуб
- [ ] Алкоголь
- [ ] Такси
- [ ] Транспорт
- [ ] Кино
- [ ] Праздники
- [ ] Интерьер
- [ ] Мобильная связь
- [ ] Налог
- [ ] Квартира
- [ ] Одежда
- [ ] Спорт
- [ ] Самообразование
- [ ] Учеба
- [ ] Долги
- [ ] Маме
- [ ] Подписки
- [ ] Шаурма
- [ ] Обед в столовых
