/* project-code-master.js — Settings · 프로젝트 Code 관리 (대·소분류 마스터, 스프레드시트 A~E) */
/* 테이블: project_code_types — docs/sql/dev_schema_project_code_types.sql + dev_rls_anon_allow_all.sql */

let _pcmRows = [];

function _pcmCanManage(session) {
  return !!(session && (Auth.isAdmin(session) || Auth.isTopMgr(session)));
}

function _pcmEsc(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _pcmNormCode(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function init_master_project_codes() {
  const session = getSession();
  if (!_pcmCanManage(session)) {
    navigateTo('dashboard');
    Toast.warning('프로젝트 Code 관리는 관리자/Top Mgr만 사용할 수 있습니다.');
    return;
  }
  await loadProjectCodeTypes();
}

async function loadProjectCodeTypes() {
  const tbody = document.getElementById('project-code-types-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>불러오는 중…</p></td></tr>';
  try {
    _pcmRows = await API.listAllPages('project_code_types', { limit: 500, maxPages: 10, sort: 'main_code' }).catch((e) => {
      console.error(e);
      return [];
    });
  } catch (e) {
    _pcmRows = [];
    Toast.error('목록 조회 실패: ' + (e.message || '') + ' — Supabase에 project_code_types 테이블·RLS를 적용했는지 확인하세요.');
  }
  _pcmFillMainFilter();
  renderProjectCodeTypes();
}

function _pcmFillMainFilter() {
  const sel = document.getElementById('project-code-filter-main');
  if (!sel) return;
  const mains = [...new Set(_pcmRows.map((r) => r.main_category).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">대분류 전체</option>' + mains.map((m) => `<option value="${_pcmEsc(m)}">${Utils.escHtml(m)}</option>`).join('');
  if (cur && mains.includes(cur)) sel.value = cur;
}

function renderProjectCodeTypes() {
  const tbody = document.getElementById('project-code-types-body');
  const kw = (document.getElementById('project-code-search')?.value || '').trim().toLowerCase();
  const mainF = document.getElementById('project-code-filter-main')?.value || '';

  let rows = _pcmRows.slice();
  if (mainF) rows = rows.filter((r) => r.main_category === mainF);
  if (kw) {
    rows = rows.filter((r) => {
      const blob = [r.main_category, r.main_code, r.sub_category, r.sub_code, r.project_name_en].join(' ').toLowerCase();
      return blob.includes(kw);
    });
  }
  rows.sort((a, b) => {
    const mc = String(a.main_code || '').localeCompare(String(b.main_code || ''));
    if (mc !== 0) return mc;
    return String(a.sub_code || '').localeCompare(String(b.sub_code || ''));
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-code"></i><p>등록된 프로젝트 코드 유형이 없습니다.</p></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${Utils.escHtml(r.main_category || '')}</td>
      <td><strong>${Utils.escHtml(r.main_code || '')}</strong></td>
      <td>${Utils.escHtml(r.sub_category || '')}</td>
      <td><strong>${Utils.escHtml(r.sub_code || '')}</strong></td>
      <td>${Utils.escHtml(r.project_name_en || '')}</td>
      <td style="font-size:11px;color:var(--text-muted)">${Utils.escHtml(r.main_code || '')}_${Utils.escHtml(r.sub_code || '')}_<strong>YYMM</strong>_01</td>
      <td style="text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button type="button" class="btn btn-sm btn-outline btn-icon" onclick="openProjectCodeModal('${_pcmEsc(r.id)}')" title="수정"><i class="fas fa-edit"></i></button>
          <button type="button" class="btn btn-sm btn-danger btn-icon" onclick="deleteProjectCodeType('${_pcmEsc(r.id)}','${_pcmEsc((r.main_code || '') + '_' + (r.sub_code || ''))}')" title="삭제"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

function openProjectCodeModal(id) {
  id = id || '';
  document.getElementById('project-code-edit-id').value = id;
  document.getElementById('project-code-main-cat').value = '';
  document.getElementById('project-code-main-code').value = '';
  document.getElementById('project-code-sub-cat').value = '';
  document.getElementById('project-code-sub-code').value = '';
  document.getElementById('project-code-name-en').value = '';
  document.getElementById('projectCodeModalTitle').textContent = id ? '프로젝트 Code 행 수정' : '프로젝트 Code 행 추가';
  if (id) {
    const r = _pcmRows.find((x) => x.id === id);
    if (r) {
      document.getElementById('project-code-main-cat').value = r.main_category || '';
      document.getElementById('project-code-main-code').value = r.main_code || '';
      document.getElementById('project-code-sub-cat').value = r.sub_category || '';
      document.getElementById('project-code-sub-code').value = r.sub_code || '';
      document.getElementById('project-code-name-en').value = r.project_name_en || '';
    }
  }
  openModal('projectCodeModal');
  setTimeout(() => document.getElementById('project-code-main-cat').focus(), 80);
}

async function saveProjectCodeType() {
  const session = getSession();
  if (!_pcmCanManage(session)) {
    Toast.warning('프로젝트 코드 유형 추가·수정은 관리자/Top Mgr만 가능합니다.');
    return;
  }
  const id = document.getElementById('project-code-edit-id').value;
  const mainCat = document.getElementById('project-code-main-cat').value.trim();
  const mainCode = _pcmNormCode(document.getElementById('project-code-main-code').value);
  const subCat = document.getElementById('project-code-sub-cat').value.trim();
  const subCode = _pcmNormCode(document.getElementById('project-code-sub-code').value);
  const nameEn = document.getElementById('project-code-name-en').value.trim();

  if (!mainCat || !mainCode || !subCat || !subCode || !nameEn) {
    Toast.warning('모든 필드를 입력하세요.');
    return;
  }
  if (mainCode.length < 2 || mainCode.length > 8) {
    Toast.warning('대분류 Code는 2~8자(영숫자)로 입력하세요.');
    return;
  }
  if (subCode.length < 2 || subCode.length > 8) {
    Toast.warning('소분류 Code는 2~8자(영숫자)로 입력하세요.');
    return;
  }

  const dup = _pcmRows.find((r) => r.main_code === mainCode && r.sub_code === subCode && r.id !== id);
  if (dup) {
    Toast.warning('동일한 대분류Code·소분류Code 조합이 이미 있습니다.');
    return;
  }

  const payload = {
    main_category: mainCat,
    main_code: mainCode,
    sub_category: subCat,
    sub_code: subCode,
    project_name_en: nameEn,
  };

  try {
    if (id) await API.patch('project_code_types', id, payload);
    else await API.create('project_code_types', payload);
    Toast.success(id ? '수정되었습니다.' : '추가되었습니다.');
    closeModal('projectCodeModal');
    await loadProjectCodeTypes();
  } catch (e) {
    Toast.error('저장 실패: ' + (e.message || e));
  }
}

async function deleteProjectCodeType(id, label) {
  const session = getSession();
  if (!_pcmCanManage(session)) {
    Toast.warning('프로젝트 코드 유형 삭제는 관리자/Top Mgr만 가능합니다.');
    return;
  }
  if (!await Confirm.delete(label || '이 행')) return;
  try {
    await API.delete('project_code_types', id);
    Toast.success('삭제되었습니다.');
    await loadProjectCodeTypes();
  } catch (e) {
    Toast.error('삭제 실패: ' + (e.message || e));
  }
}

function openProjectCodeUploadModal() {
  document.getElementById('project-code-upload-file').value = '';
  const r = document.getElementById('project-code-upload-result');
  if (r) {
    r.style.display = 'none';
    r.textContent = '';
  }
  openModal('projectCodeUploadModal');
}

async function uploadProjectCodeTypes() {
  const session = getSession();
  if (!_pcmCanManage(session)) {
    Toast.warning('프로젝트 코드 엑셀 업로드는 관리자/Top Mgr만 가능합니다.');
    return;
  }
  const file = document.getElementById('project-code-upload-file').files[0];
  if (!file) {
    Toast.warning('파일을 선택하세요.');
    return;
  }
  const btn = document.querySelector('#projectCodeUploadModal .btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';
  }
  try {
    const data = await Utils.parseExcel(file);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const working = _pcmRows.slice();

    for (const row of data) {
      const mainCat = String(row['대분류'] || row.main_category || '').trim();
      const mainCode = _pcmNormCode(row['대분류Code'] || row.main_code || '');
      const subCat = String(row['소분류'] || row.sub_category || '').trim();
      const subCode = _pcmNormCode(row['소분류Code'] || row.sub_code || '');
      const nameEn = String(row['프로젝트명'] || row.project_name_en || row['프로젝트명(EN)'] || '').trim();
      if (!mainCat || !mainCode || !subCat || !subCode || !nameEn) {
        skipped++;
        continue;
      }
      try {
        const existing = working.find((r) => r.main_code === mainCode && r.sub_code === subCode);
        if (existing) {
          await API.patch('project_code_types', existing.id, {
            main_category: mainCat,
            sub_category: subCat,
            project_name_en: nameEn,
          });
          existing.main_category = mainCat;
          existing.sub_category = subCat;
          existing.project_name_en = nameEn;
          updated++;
        } else {
          const created = await API.create('project_code_types', {
            main_category: mainCat,
            main_code: mainCode,
            sub_category: subCat,
            sub_code: subCode,
            project_name_en: nameEn,
          });
          if (created && created.id) working.push(created);
          added++;
        }
      } catch {
        errors++;
      }
    }
    _pcmRows = working;
    const result = document.getElementById('project-code-upload-result');
    if (result) {
      result.style.display = '';
      result.className = errors ? 'alert alert-warning' : 'alert alert-success';
      result.innerHTML = `<i class="fas fa-check-circle"></i> 추가 ${added} / 갱신 ${updated} / 스킵 ${skipped} / 오류 ${errors}`;
    }
    await loadProjectCodeTypes();
  } catch (e) {
    Toast.error('업로드 실패: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-upload"></i> 업로드';
    }
  }
}

async function downloadProjectCodeTemplate() {
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['대분류', '대분류Code', '소분류', '소분류Code', '프로젝트명'],
    ['관세심사', 'AUD', 'AEO종합심사', 'AEO', 'AEO Audit'],
    ['관세심사', 'AUD', '법인심사', 'Cor', 'Customs Corporate Audit'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '프로젝트코드');
  await xlsxDownload(wb, '프로젝트코드_DB_업로드_양식.xlsx');
}

/** 현재 목록(필터·검색 적용)을 업로드와 동일한 열 구조로 엑셀 저장 */
async function downloadProjectCodeTypesExport() {
  const session = getSession();
  if (!_pcmCanManage(session)) {
    Toast.warning('프로젝트 코드보내기는 관리자/Top Mgr만 사용할 수 있습니다.');
    return;
  }
  const rows = _pcmGetFilteredRows();
  if (!rows.length) {
    Toast.warning('보낼 데이터가 없습니다. 새로고침 후 다시 시도하세요.');
    return;
  }
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const aoa = [
    ['대분류', '대분류Code', '소분류', '소분류Code', '프로젝트명'],
    ...rows.map((r) => [
      r.main_category || '',
      r.main_code || '',
      r.sub_category || '',
      r.sub_code || '',
      r.project_name_en || '',
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, '프로젝트코드');
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await xlsxDownload(wb, `프로젝트코드_보내기_${day}.xlsx`);
  Toast.success(`엑셀 ${rows.length}건을 저장했습니다.`);
}
window.init_master_project_codes = init_master_project_codes;
window.loadProjectCodeTypes = loadProjectCodeTypes;
window.renderProjectCodeTypes = renderProjectCodeTypes;
window.openProjectCodeModal = openProjectCodeModal;
window.saveProjectCodeType = saveProjectCodeType;
window.deleteProjectCodeType = deleteProjectCodeType;
window.openProjectCodeUploadModal = openProjectCodeUploadModal;
window.uploadProjectCodeTypes = uploadProjectCodeTypes;
window.downloadProjectCodeTemplate = downloadProjectCodeTemplate;
window.downloadProjectCodeTypesExport = downloadProjectCodeTypesExport;
