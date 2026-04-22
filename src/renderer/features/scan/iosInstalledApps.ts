type RenderIosInstalledAppsArgs = {
  apps: any[];
  container: HTMLElement | null;
  clear(target: Element): void;
  formatAppName(name: string): string;
};

export function renderIosInstalledApps({ apps, container, clear, formatAppName }: RenderIosInstalledAppsArgs): void {
  if (!container) return;

  const list = Array.isArray(apps) ? apps : [];
  clear(container);

  if (!list.length) {
    container.innerHTML = `
                        <div class="scs-49866b83">
                            검사 대상 애플리케이션이 없습니다.
                        </div>
                    `;
    return;
  }

  const sorted = [...list].sort((a, b) => {
    const an = (a.cachedTitle || a.name || a.displayName || a.packageName || a.bundleId || '').toString();
    const bn = (b.cachedTitle || b.name || b.displayName || b.packageName || b.bundleId || '').toString();
    return an.localeCompare(bn);
  });

  const grid = document.createElement('div');
  grid.className = 'ios-app-grid';

  sorted.forEach(app => {
    const name = app.cachedTitle || app.name || app.displayName || formatAppName(app.packageName || app.bundleId || '');
    const bundle = app.packageName || app.bundleId || '';

    const card = document.createElement('div');
    card.className = 'ios-app-card';

    const titleEl = document.createElement('div');
    titleEl.className = 'ios-app-name';
    titleEl.textContent = name;

    card.appendChild(titleEl);

    if (bundle) {
      const subEl = document.createElement('div');
      subEl.className = 'ios-app-bundle';
      subEl.textContent = bundle;
      card.appendChild(subEl);
    }

    grid.appendChild(card);
  });

  container.appendChild(grid);
}
