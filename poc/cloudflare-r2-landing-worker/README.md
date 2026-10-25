# Cloudflare R2 Landing Worker PoC

Ізольований прототип для перевірки роздачі статичних файлів із приватного R2
через один Worker. Він не інтегрований із CRMONIA, Supabase, Intake API,
Landing Factory або Render. У Worker немає операцій запису чи видалення R2.

## Формат об'єктів у тестовому bucket

Для кожного сайту створюється точний маніфест hostname:

```text
host-manifests/shop.example.test.json
```

Вміст маніфесту:

```json
{ "sitePrefix": "sites/landing-1/version-1/" }
```

Файли сайту:

```text
sites/landing-1/version-1/index.html
sites/landing-1/version-1/assets/site.css
```

Hostname нормалізується до нижнього регістру та шукається тільки за повним
точним збігом. Відсутній або некоректний маніфест дає 404. Префікс має формат
`sites/{siteId}/{versionId}/`; довільний ключ із запиту чи маніфесту не може
вийти за цей префікс. Доступні лише `GET` і `HEAD`; лістинг директорій відсутній.
Шляхи з прихованими сегментами на кшталт `.env` і `.git` також відхиляються.

Відповіді PoC мають `Cache-Control: no-store`, щоб перевірка не маскувала
застарілі відповіді під час майбутнього перемикання версій. Перед бойовою
публікацією треба окремо спроєктувати версійні URL assets і кешування.

## Локальні перевірки

Із кореня репозиторію:

```powershell
bun test poc/cloudflare-r2-landing-worker/test/index.test.ts
bun x tsc --noEmit -p poc/cloudflare-r2-landing-worker/tsconfig.json
```

Локальні тести використовують mock R2 і не потребують облікового запису
Cloudflare. Для локального запуску Worker потрібен Wrangler:

```powershell
bunx wrangler dev --config poc/cloudflare-r2-landing-worker/wrangler.jsonc
```

Wrangler за замовчуванням використовує локальну емуляцію R2. Не вмикайте `remote`
binding для цього PoC: це під'єднає локальний Worker до справжнього bucket.

## Ручна перевірка в ізольованій тестовій зоні

Ці кроки створюють зовнішні ресурси; виконуйте їх вручну лише в окремій тестовій
зоні та після вибору тестового домену. Не використовуйте production bucket.

1. Активуйте тестову DNS-зону в Cloudflare. Створіть окремий приватний R2 bucket
   `crmonia-landing-poc-test`; не вмикайте публічний `r2.dev` чи custom domain для
   bucket.
2. Перевірте, що назва bucket у `wrangler.jsonc` збігається з тестовим. Виконайте
   `bunx wrangler login`, а потім
   `bunx wrangler deploy --config poc/cloudflare-r2-landing-worker/wrangler.jsonc`.
   Конфігурація вмикає `workers.dev` для PoC, але не задає власний route; wildcard
   маршрут до тестового домену додайте окремо через Dashboard.
3. У R2 Dashboard завантажте маніфест для одного тестового hostname і файли
   `index.html` та `assets/site.css` із прикладу вище.
4. Для перевірки wildcard-маршруту створіть у DNS тестової зони proxied wildcard
   запис (`AAAA *` → `100::`) і route `https://*.<тестовий-домен>/*` до цього
   Worker. Переконайтеся, що зона активна, а hostname — першого рівня.
5. Перевірте:

   ```powershell
   curl.exe -i https://shop.<тестовий-домен>/
   curl.exe -i https://shop.<тестовий-домен>/assets/site.css
   curl.exe -i https://unknown.<тестовий-домен>/
   curl.exe --path-as-is -i https://shop.<тестовий-домен>/%2e%2e%2fprivate.txt
   ```

   Очікування: тестовий сайт і CSS — `200`, невідомий hostname — `404`, traversal
   — `400`; браузер має бачити валідний HTTPS-сертифікат. Не вважайте HTTPS готовим,
   доки не перевірено запит із зовнішньої мережі.

6. Якщо wildcard Route не працює як origin Worker, видаліть його та додайте один
   точний Custom Domain, наприклад `shop.<тестовий-домен>`, до того самого Worker.
   Cloudflare має створити DNS-запис і сертифікат автоматично. Цей fallback
   перевіряє видачу через Worker, але не поведінку wildcard-маршруту.
7. Після PoC видаліть route/Custom Domain, Worker і тестовий bucket через
   Cloudflare Dashboard.

Налаштування в PoC навмисно не містять account ID, zone ID, API token, route чи
реальних hostname. Cloudflare API token для цього прототипу не потрібен.
