export function bindUpdateUi({ CustomUI }) {
    window.electronAPI.onUpdateStart((version) => {
        const modal = document.getElementById('update-modal');
        const verText = document.getElementById('update-ver-text');
        if (verText) verText.textContent = `V${version}으로 업데이트를 시작합니다.`;
        modal?.classList.remove('hidden');
    });

    window.electronAPI.onUpdateProgress((data) => {
        const fill = document.getElementById('update-progress-fill');
        const percentText = document.getElementById('update-percent');
        const speedText = document.getElementById('update-speed');
        const sizeText = document.getElementById('update-size-info');

        if (fill) fill.style.width = `${data.percent}%`;
        if (percentText) percentText.textContent = `${data.percent}%`;
        if (speedText) speedText.textContent = data.bytesPerSecond;
        if (sizeText) sizeText.textContent = `${data.transferred} / ${data.total}`;
    });

    window.electronAPI.onUpdateError(async (msg) => {
        await CustomUI.alert('업데이트 중 오류가 발생했습니다: ' + msg);
        document.getElementById('update-modal')?.classList.add('hidden');
    });
}
