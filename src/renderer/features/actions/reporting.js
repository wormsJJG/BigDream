export function bindResultReporting({
    State,
    CustomUI,
    services,
    firestore,
    formatDateTimeKR
}) {
    const { doc, getDoc, collection, getDocs, query, orderBy, addDoc, serverTimestamp } = firestore;

    const showHistory = async (uid) => {
        const modal = document.getElementById('admin-result-modal');
        const content = document.getElementById('admin-result-content');
        modal?.classList.remove('hidden');
        if (content) content.innerHTML = '데이터 조회 중...';

        try {
            const historyRef = collection(null, 'users', uid, 'scanResults');
            const q = query(historyRef, orderBy('date', 'desc'));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                if (content) content.innerHTML = '<p>📭 제출된 검사 결과가 없습니다.</p>';
                return;
            }

            let html = '<ul class="file-list" style="max-height:400px;">';
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const date = data.date ? formatDateTimeKR(data.date) : '날짜 없음';
                const threatCount = data.threatCount || 0;
                const style = threatCount > 0 ? 'color:red; font-weight:bold;' : 'color:green;';

                html += `
                    <li style="padding:10px; border-bottom:1px solid #eee;">
                        <div>🕒 <b>${date}</b></div>
                        <div style="${style}">결과: 스파이앱 ${threatCount}개 발견</div>
                        <div style="font-size:12px; color:#666;">모델: ${data.model} (Serial: ${data.serial})</div>
                    </li>
                `;
            });
            html += '</ul>';
            if (content) content.innerHTML = html;
        } catch (e) {
            if (content) content.innerHTML = `<p style="color:red;">기록 조회 실패: ${e.message}</p>`;
        }
    };

    const historyButtons = document.querySelectorAll('[data-action="view-history"], [data-reporting-action="view-history"]');
    historyButtons.forEach((button) => {
        if (button.dataset.boundClick === 'true') return;
        button.dataset.boundClick = 'true';
        button.addEventListener('click', async () => {
            const uid = button.dataset.uid || '';
            if (!uid) return;
            await showHistory(uid);
        });
    });

    const reportResultsBtn = document.getElementById('report-results-btn');
    if (!reportResultsBtn) return;

    reportResultsBtn.addEventListener('click', async () => {
        if (!State.lastScanData) {
            await CustomUI.alert('전송할 검사 결과 데이터가 없습니다.');
            return;
        }

        const message = await CustomUI.prompt(
            '서버로 결과를 전송하시겠습니까?\n관리자에게 남길 메모가 있다면 적어주세요.',
            '특이사항 없음'
        );
        if (message === null) return;

        reportResultsBtn.disabled = true;
        reportResultsBtn.textContent = '전송 중...';

        try {
            const user = (services?.auth?.getCurrentUser && services.auth.getCurrentUser()) || auth?.currentUser || null;
            const scanData = State.lastScanData;

            let currentCompanyName = '알 수 없는 업체';
            if (user && user.uid) {
                try {
                    const uSnap = await getDoc(doc(null, 'users', user.uid));
                    if (uSnap.exists()) {
                        currentCompanyName = uSnap.data().companyName || user.email;
                    }
                } catch (e) {
                    console.error('업체명 조회 실패:', e);
                }
            }

            const clientName = document.getElementById('client-name')?.value || '익명';
            const clientDob = document.getElementById('client-dob')?.value || '0000-00-00';
            const clientPhone = document.getElementById('client-phone')?.value || '000-0000-0000';
            const detectedApps = scanData.suspiciousApps;
            const deviceInfo = {
                model: scanData.deviceInfo.model,
                serial: scanData.deviceInfo.serial,
                os: State.currentDeviceMode
            };

            await addDoc(collection(null, 'reported_logs'), {
                agencyId: user?.uid || 'anonymous_agent',
                agencyName: currentCompanyName,
                agencyEmail: user?.email || '-',
                clientInfo: {
                    name: clientName,
                    dob: clientDob,
                    phone: clientPhone
                },
                deviceInfo,
                suspiciousApps: detectedApps,
                threatCount: detectedApps.length,
                message,
                reportedAt: serverTimestamp()
            });

            await CustomUI.alert('✅ 결과가 서버로 성공적으로 전송되었습니다.');
        } catch (error) {
            console.error('전송 실패:', error);
            await CustomUI.alert('전송 실패: ' + error.message);
        } finally {
            reportResultsBtn.disabled = false;
            reportResultsBtn.textContent = '📡 서버 전송';
        }
    });
}
