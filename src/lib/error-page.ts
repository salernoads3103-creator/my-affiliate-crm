export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>Не вдалося завантажити сторінку</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 data-error-title>Не вдалося завантажити сторінку</h1>
      <p data-error-message>Сталася помилка. Оновіть сторінку або поверніться на головну.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()" data-error-retry>Спробувати ще раз</button>
        <a class="secondary" href="/" data-error-home>На головну</a>
      </div>
    </div>
    <script>
      (() => {
        const copy = {
          uk: {
            title: "Не вдалося завантажити сторінку",
            message: "Сталася помилка. Оновіть сторінку або поверніться на головну.",
            retry: "Спробувати ще раз",
            home: "На головну",
          },
          en: {
            title: "This page didn't load",
            message: "Something went wrong. Refresh the page or go back home.",
            retry: "Try again",
            home: "Go home",
          },
        };
        let locale = "uk";
        try {
          locale = localStorage.getItem("crmonia-locale") === "en" ? "en" : "uk";
        } catch {
          // Ukrainian is the default when browser storage is unavailable.
        }
        const text = copy[locale];
        document.documentElement.lang = locale;
        document.title = text.title;
        document.querySelector("[data-error-title]").textContent = text.title;
        document.querySelector("[data-error-message]").textContent = text.message;
        document.querySelector("[data-error-retry]").textContent = text.retry;
        document.querySelector("[data-error-home]").textContent = text.home;
      })();
    </script>
  </body>
</html>`;
}
