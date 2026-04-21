export function createAdminCommonHelpers({ toDateSafe }) {
    return {
        calculateScanStats(docs) {
            const now = new Date();
            const stats = { today: 0, month: 0, year: 0, total: 0 };

            docs.forEach((doc) => {
                const data = doc.data();
                if (!data.startTime) return;
                const date = toDateSafe(data.startTime);
                if (!date) return;

                stats.total++;

                if (date.getFullYear() === now.getFullYear()) {
                    stats.year++;
                    if (date.getMonth() === now.getMonth()) {
                        stats.month++;
                        if (date.getDate() === now.getDate()) {
                            stats.today++;
                        }
                    }
                }
            });
            return stats;
        },

        resetPagedState(state) {
            state.currentPage = 1;
            state.loadedPages = [];
            state.pageCursors = [];
            state.hasMore = false;
            if (Object.prototype.hasOwnProperty.call(state, 'legacyRows')) {
                state.legacyRows = null;
            }
            if (Object.prototype.hasOwnProperty.call(state, 'allRows')) {
                state.allRows = null;
            }
        },

        renderPageButtons({ containerId, state, buttonClass, onClick }) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const totalKnownPages = state.loadedPages.length;
            if (totalKnownPages <= 1 && !state.hasMore) {
                container.innerHTML = '';
                return;
            }

            const pageGroupSize = 10;
            const currentGroup = Math.floor((Math.max(1, state.currentPage) - 1) / pageGroupSize);
            const startPage = currentGroup * pageGroupSize + 1;
            const groupLastPage = startPage + pageGroupSize - 1;
            const endPage = Math.min(groupLastPage, Math.max(startPage, totalKnownPages));
            const hasPrevGroup = startPage > 1;
            const hasProgressiveNextPage = state.hasMore && endPage < groupLastPage;
            const hasNextGroup = state.hasMore && endPage === groupLastPage;

            let html = '<div style="display:flex; justify-content:center; gap:6px; flex-wrap:wrap; margin-top:12px;">';

            if (hasPrevGroup) {
                const prevGroupPage = startPage - 1;
                html += `<button type="button" class="${buttonClass}" data-page="${prevGroupPage}" data-nav="prev-group" style="min-width:56px; height:36px; border:1px solid #d1d5db; border-radius:8px; cursor:pointer; background:#fff; color:#333;">이전</button>`;
            }

            for (let i = startPage; i <= endPage; i++) {
                const activeStyle = i === state.currentPage
                    ? 'background:#2563eb; color:#fff; border-color:#2563eb;'
                    : 'background:#fff; color:#333; border-color:#d1d5db;';
                html += `<button type="button" class="${buttonClass}" data-page="${i}" style="min-width:36px; height:36px; border:1px solid; border-radius:8px; cursor:pointer; ${activeStyle}">${i}</button>`;
            }

            if (hasProgressiveNextPage) {
                const nextPage = endPage + 1;
                html += `<button type="button" class="${buttonClass}" data-page="${nextPage}" style="min-width:36px; height:36px; border:1px solid #d1d5db; border-radius:8px; cursor:pointer; background:#fff; color:#333;">${nextPage}</button>`;
            }

            if (hasNextGroup) {
                const nextGroupPage = endPage + 1;
                html += `<button type="button" class="${buttonClass}" data-page="${nextGroupPage}" data-nav="next-group" style="min-width:56px; height:36px; border:1px solid #d1d5db; border-radius:8px; cursor:pointer; background:#fff; color:#333;">다음</button>`;
            }
            html += '</div>';
            container.innerHTML = html;

            container.querySelectorAll(`.${buttonClass}`).forEach((btn) => {
                btn.onclick = () => {
                    const page = Number(btn.dataset.page || 1);
                    onClick(page);
                };
            });
        }
    };
}
