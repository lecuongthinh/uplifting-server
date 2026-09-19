// 3 tab quản trị mới chèn vào trang /admin/content: Quà tặng, Nhãn OA, Tương tác & OA.
// Luật nhập liệu KHÔNG nằm ở đây: form hiển thị luật + lỗi do SERVER trả về
// (lib/giftRules.js, lib/oaTagRegistry.js) — để ai cũng dùng được mà không phải
// nhớ luật. File này chỉ là HTML/JS thuần chèn vào template của contentAdmin.js
// (JS phía trình duyệt cố ý KHÔNG dùng backtick/${} để khỏi phải escape).

export const OA_TAB_IDS = ["gifts", "oatags", "oastatus"];

export const OA_TAB_BUTTONS = `
      <button class="tab-btn" data-tab="gifts">Quà tặng</button>
      <button class="tab-btn" data-tab="oatags">Nhãn OA</button>
      <button class="tab-btn" data-tab="oastatus">Tương tác &amp; OA</button>`;

export const OA_PANELS = `
    <div class="tab-panel" id="tab-gifts" hidden>
      <h2>Quà tặng khi chia sẻ SĐT + follow OA</h2>
      <div id="g_disabled" class="msg error"></div>
      <div id="g_rules" class="muted"></div>
      <table id="giftsTable"><thead><tr><th>Quà</th><th>Trạng thái</th><th>Kết quả gửi</th><th></th></tr></thead><tbody></tbody></table>
      <div id="g_msg" class="msg"></div>

      <fieldset>
        <legend id="g_legend">Tạo quà mới</legend>
        <div id="g_editing" class="editing-banner">Đang sửa quà có sẵn (mã quà và điều kiện không đổi được).</div>
        <label>Mã quà (không đổi được sau khi tạo) <input id="g_key" placeholder="chao-mung-ebook" /></label>
        <label>Tên quà (hiện trong tin nhắn) <input id="g_title" placeholder="Ebook 5 bước quản trị năng lượng" /></label>
        <label>Loại
          <select id="g_kind">
            <option value="external_url">Link ngoài (tài liệu, video, trang web...)</option>
            <option value="miniapp_link">Trang trong Mini App</option>
          </select>
        </label>
        <label>Chèn nhanh link trang trong Mini App <select id="g_quick"><option value="">— chọn để điền vào ô link —</option></select></label>
        <label>Đường dẫn quà (https://...) <input id="g_url" placeholder="https://..." /></label>
        <label>Tin nhắn gửi qua OA — bắt buộc có {link}; có thể dùng {name}, {gift}
          <textarea id="g_template">Chào {name}, Uplifting tặng bạn "{gift}": {link}</textarea>
        </label>
        <div class="muted">Xem thử: <span id="g_preview"></span></div>
        <label>Ngày kết thúc (tuỳ chọn) <input id="g_ends" type="date" /></label>
        <label><input type="checkbox" id="g_req_miniapp" checked /> Điều kiện: đã chia sẻ SĐT với Mini App</label>
        <label><input type="checkbox" id="g_req_follow" checked /> Điều kiện: đã follow OA</label>
        <button class="btn-primary" id="g_save">Tạo quà (ở trạng thái TẮT)</button>
        <button class="btn-secondary" id="g_cancel" style="display:none">Huỷ</button>
        <div id="g_form_msg" class="msg"></div>
      </fieldset>

      <fieldset>
        <legend>Gửi thử tới hồ sơ test</legend>
        <p class="muted">Chỉ gửi được cho hồ sơ có tag "Hồ sơ test — Mini App". Tài khoản đó phải vừa nhắn tin cho OA (trong 7 ngày) thì Zalo mới cho gửi.</p>
        <label>Quà <select id="g_test_gift"></select></label>
        <label>SĐT hồ sơ test <input id="g_test_phone" placeholder="09..." /></label>
        <button class="btn-primary" id="g_test_btn">Gửi thử</button>
        <div id="g_test_msg" class="msg"></div>
      </fieldset>

      <fieldset>
        <legend>Lượt tặng</legend>
        <label>Quà <select id="g_grants_gift"></select></label>
        <label>Lọc trạng thái
          <select id="g_grants_status">
            <option value="">Tất cả</option><option value="delivered">Đã gửi</option><option value="pending_window">Chờ khách nhắn tin</option>
            <option value="no_uid">Chưa có Zalo UID</option><option value="failed">Lỗi</option><option value="excluded">Loại trừ (đủ điều kiện từ trước)</option>
          </select>
        </label>
        <button class="btn-small" id="g_grants_btn">Xem</button>
        <table id="grantsTable"><thead><tr><th>SĐT</th><th>Trạng thái</th><th>Lần thử</th><th>Lỗi</th><th></th></tr></thead><tbody></tbody></table>
      </fieldset>
    </div>

    <div class="tab-panel" id="tab-oatags" hidden>
      <h2>Nhãn OA đồng bộ 2 chiều với tag CRM</h2>
      <div id="t_rules" class="muted"></div>
      <table id="tagsTable"><thead><tr><th>Tag CRM</th><th>Nhãn trên OA</th><th>Mô tả</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
      <fieldset>
        <legend>Đăng ký nhãn mới</legend>
        <label>Tên nhãn trên OA <input id="t_name" placeholder="VD: VIP" /></label>
        <div id="t_name_msg" class="msg"></div>
        <label>Mô tả (bắt buộc — nhãn dùng để làm gì, gắn cho ai) <input id="t_desc" /></label>
        <button class="btn-primary" id="t_register">Đăng ký nhãn</button>
        <div id="t_msg" class="msg"></div>
      </fieldset>
      <fieldset>
        <legend>Đồng bộ ngược OA → CRM (kéo hàng loạt)</legend>
        <p class="muted">Zalo không báo khi nhãn đổi, nên nhãn gắn tay trên OA chỉ về CRM khi khách có tương tác OA hoặc khi bấm nút này. Bấm 1 lần để ĐẾM trước, rồi xác nhận.</p>
        <button class="btn-small" id="t_pull_dry">Đếm khách sẽ được kéo</button>
        <button class="btn-small" id="t_pull_go" style="display:none">Xác nhận kéo ngay</button>
        <div id="t_pull_msg" class="msg"></div>
      </fieldset>
      <fieldset>
        <legend>Nhật ký đồng bộ gần đây</legend>
        <button class="btn-small" id="t_log_btn">Tải nhật ký</button>
        <table id="tagLogTable"><thead><tr><th>Lúc</th><th>SĐT</th><th>Kết quả</th><th>Chi tiết</th></tr></thead><tbody></tbody></table>
      </fieldset>
    </div>

    <div class="tab-panel" id="tab-oastatus" hidden>
      <h2>Tương tác &amp; cài đặt OA</h2>
      <fieldset>
        <legend>Kiểm tra cài đặt</legend>
        <p class="muted">Đo thật từng bước (biến môi trường, quyền OA, quyền GHL, bảng dữ liệu) — cái nào chưa xong sẽ báo đỏ kèm lý do.</p>
        <button class="btn-primary" id="s_check">Kiểm tra</button>
        <a class="btn-small" id="s_oauth" target="_blank" style="margin-left:8px;text-decoration:none">Cấp quyền OA (lần đầu)</a>
        <div id="s_checklist"></div>
        <button class="btn-small" id="s_fields" style="display:none">Tạo field ngày còn thiếu trên GHL</button>
        <div id="s_msg" class="msg"></div>
      </fieldset>
      <fieldset>
        <legend>Số liệu (từ lúc bật tính năng, không backfill)</legend>
        <button class="btn-small" id="s_sum_btn">Tải số liệu</button>
        <div id="s_sum" class="muted"></div>
      </fieldset>
      <fieldset>
        <legend>Tra cứu 1 khách</legend>
        <label>SĐT <input id="s_phone" placeholder="09..." /></label>
        <button class="btn-small" id="s_lookup_btn">Tra</button>
        <pre id="s_lookup" class="muted" style="white-space:pre-wrap"></pre>
      </fieldset>
    </div>`;

// Chạy trong CÙNG thẻ <script> với trang nội dung: dùng lại secret(), state,
// showMsg(), TABS. `MINIAPP_ID` do contentAdmin.js chèn vào.
export const OA_SCRIPT = String.raw`
    // ================= Quà tặng / Nhãn OA / Tương tác & OA =================
    async function oaApi(path, body) {
      const res = await fetch('/admin/oa' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ secret: secret() }, body || {})),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { const e = new Error(data.message || 'Lỗi không rõ'); e.data = data; throw e; }
      return data;
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function el(id) { return document.getElementById(id); }
    var GIFT_STATUS_LABEL = { delivered: 'đã gửi', pending_window: 'chờ khách nhắn tin', no_uid: 'chưa có UID', failed: 'lỗi', excluded: 'loại trừ' };
    var giftsCache = [];
    var editingGiftId = null;

    // ---------- Quà tặng ----------
    function buildQuickLinks() {
      var sel = el('g_quick');
      var base = 'https://zalo.me/s/' + MINIAPP_ID + '/?path=';
      var opts = ['<option value="">— chọn để điền vào ô link —</option>'];
      opts.push('<option value="' + base + '/khoa-hoc">Trang: Danh sách khoá học</option>');
      opts.push('<option value="' + base + '/tai-nguyen">Trang: Tài nguyên</option>');
      opts.push('<option value="' + base + '/danh-gia">Trang: Bài đánh giá</option>');
      (state.courses || []).forEach(function (c) { opts.push('<option value="' + base + '/khoa-hoc/' + esc(c.slug) + '">Khoá: ' + esc(c.title) + '</option>'); });
      (state.articles || []).forEach(function (a) { opts.push('<option value="' + base + '/bai-viet/' + esc(a.slug) + '">Bài viết: ' + esc(a.title) + '</option>'); });
      sel.innerHTML = opts.join('');
    }
    el('g_quick').addEventListener('change', function () {
      if (el('g_quick').value) { el('g_url').value = el('g_quick').value; el('g_kind').value = 'miniapp_link'; }
    });
    function renderGiftPreview() {
      var t = el('g_template').value
        .split('{name}').join('Lan').split('{gift}').join(el('g_title').value || '(tên quà)').split('{link}').join(el('g_url').value || '(link)');
      el('g_preview').textContent = t;
    }
    ['g_template', 'g_title', 'g_url'].forEach(function (id) { el(id).addEventListener('input', renderGiftPreview); });

    async function loadGifts() {
      buildQuickLinks();
      try {
        var rules = await oaApi('/gifts/rules');
        el('g_rules').innerHTML = '<b>Luật:</b><br>' + rules.rules.map(function (r) { return '• ' + esc(r); }).join('<br>');
        el('g_disabled').textContent = rules.disabled ? 'ĐANG TẮT KHẨN CẤP (GIFTS_DISABLED=true trên Render) — không quà nào được gửi.' : '';
        var data = await oaApi('/gifts/list');
        giftsCache = data.gifts;
        var rows = giftsCache.map(function (g) {
          var st = Object.keys(g.stats || {}).map(function (k) { return (GIFT_STATUS_LABEL[k] || k) + ': ' + g.stats[k]; }).join(', ') || '—';
          var state = g.active ? '<b style="color:#2f7d54">ĐANG BẬT</b>' : 'tắt';
          var actions = '<button class="btn-small" onclick="editGift(' + g.id + ')">Sửa</button> ' +
            (g.active ? '<button class="btn-small danger" onclick="deactivateGiftUi(' + g.id + ')">Tắt</button>'
                      : '<button class="btn-small" onclick="activateGiftUi(' + g.id + ')">Xem trước &amp; bật</button>');
          return '<tr><td>' + esc(g.title) + '<div class="muted">' + esc(g.gift_key) + ' · ' + esc(g.url) + '</div></td><td>' + state + '</td><td class="muted">' + esc(st) + '</td><td class="actions">' + actions + '</td></tr>';
        });
        el('giftsTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td class="muted" colspan="4">Chưa có quà nào</td></tr>';
        var opts = giftsCache.map(function (g) { return '<option value="' + g.id + '">' + esc(g.title) + '</option>'; }).join('');
        el('g_test_gift').innerHTML = opts;
        el('g_grants_gift').innerHTML = opts;
      } catch (e) { showMsg('g_msg', 'Không tải được quà: ' + e.message + ' (đã chạy sql/007 trên Supabase chưa?)', false); }
      renderGiftPreview();
    }
    function resetGiftForm() {
      editingGiftId = null;
      ['g_key', 'g_title', 'g_url', 'g_ends'].forEach(function (id) { el(id).value = ''; });
      el('g_template').value = 'Chào {name}, Uplifting tặng bạn "{gift}": {link}';
      el('g_kind').value = 'external_url';
      el('g_key').disabled = false; el('g_req_miniapp').disabled = false; el('g_req_follow').disabled = false;
      el('g_req_miniapp').checked = true; el('g_req_follow').checked = true;
      el('g_editing').classList.remove('show'); el('g_cancel').style.display = 'none';
      el('g_save').textContent = 'Tạo quà (ở trạng thái TẮT)'; el('g_legend').textContent = 'Tạo quà mới';
      renderGiftPreview();
    }
    window.editGift = function (id) {
      var g = giftsCache.find(function (x) { return x.id === id; });
      editingGiftId = id;
      el('g_key').value = g.gift_key; el('g_key').disabled = true;
      el('g_title').value = g.title; el('g_kind').value = g.kind; el('g_url').value = g.url;
      el('g_template').value = g.message_template; el('g_ends').value = g.ends_at ? g.ends_at.slice(0, 10) : '';
      el('g_req_miniapp').checked = g.require_miniapp; el('g_req_follow').checked = g.require_follow;
      el('g_req_miniapp').disabled = true; el('g_req_follow').disabled = true;
      el('g_editing').classList.add('show'); el('g_cancel').style.display = 'inline-block';
      el('g_save').textContent = 'Cập nhật quà'; el('g_legend').textContent = 'Sửa quà';
      renderGiftPreview(); el('g_key').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    el('g_cancel').addEventListener('click', resetGiftForm);
    el('g_save').addEventListener('click', async function () {
      try {
        var body = {
          id: editingGiftId || undefined, gift_key: el('g_key').value.trim(), title: el('g_title').value, kind: el('g_kind').value,
          url: el('g_url').value, message_template: el('g_template').value, ends_at: el('g_ends').value || null,
          require_miniapp: el('g_req_miniapp').checked, require_follow: el('g_req_follow').checked,
        };
        await oaApi('/gifts/save', body);
        showMsg('g_form_msg', editingGiftId ? 'Đã cập nhật quà.' : 'Đã tạo quà (đang TẮT — bấm "Xem trước & bật" khi sẵn sàng).', true);
        resetGiftForm(); loadGifts();
      } catch (e) { showMsg('g_form_msg', (e.data && e.data.errors ? e.data.errors : [e.message]).join('\n'), false); }
    });
    window.activateGiftUi = async function (id) {
      try {
        var p = await oaApi('/gifts/preview', { id: id });
        var g = giftsCache.find(function (x) { return x.id === id; });
        var include = false;
        var text = 'Bật quà "' + g.title + '"?\n\nHiện đã có ' + p.uniquePhones + ' người đủ điều kiện (tag: ' + p.requiredTags.join(' + ') + ').\n\n' +
          'Bấm OK = CHỈ tặng cho người mới đủ điều kiện từ bây giờ (' + p.uniquePhones + ' người hiện có sẽ được đánh dấu "loại trừ", không nhận quà).';
        if (!confirm(text)) return;
        if (p.uniquePhones > 0 && confirm('Muốn tặng LUÔN cho ' + p.uniquePhones + ' người đã đủ điều kiện từ trước không?\n\nOK = có (họ sẽ nhận ở lần đăng nhập/follow kế tiếp)\nHuỷ = không (giữ nguyên loại trừ)')) include = true;
        var r = await oaApi('/gifts/activate', { id: id, confirm: 'yes', includeExisting: include });
        showMsg('g_msg', 'Đã bật quà. Loại trừ ' + r.excluded + ' người đã đủ điều kiện từ trước.', true);
        loadGifts();
      } catch (e) { showMsg('g_msg', e.message, false); }
    };
    window.deactivateGiftUi = async function (id) {
      if (!confirm('Tắt quà này? Khách đủ điều kiện sau đó sẽ không nhận nữa (quà đang chờ cũng dừng gửi).')) return;
      try { await oaApi('/gifts/deactivate', { id: id }); loadGifts(); } catch (e) { showMsg('g_msg', e.message, false); }
    };
    el('g_test_btn').addEventListener('click', async function () {
      try {
        var r = await oaApi('/gifts/test-send', { id: Number(el('g_test_gift').value), phone: el('g_test_phone').value });
        showMsg('g_test_msg', 'Đã gửi:\n' + r.sent, true);
      } catch (e) { showMsg('g_test_msg', e.message, false); }
    });
    el('g_grants_btn').addEventListener('click', async function () {
      try {
        var r = await oaApi('/gifts/grants', { id: Number(el('g_grants_gift').value), status: el('g_grants_status').value || null });
        el('grantsTable').querySelector('tbody').innerHTML = r.grants.map(function (g) {
          var retry = (g.status === 'delivered' || g.status === 'excluded') ? '' : '<button class="btn-small" onclick="retryGrantUi(' + g.id + ')">Gửi lại</button>';
          return '<tr><td>' + esc(g.phone) + '</td><td>' + esc(GIFT_STATUS_LABEL[g.status] || g.status) + '</td><td>' + g.attempts + '</td><td class="muted">' + esc(g.last_error || '') + '</td><td>' + retry + '</td></tr>';
        }).join('') || '<tr><td class="muted" colspan="5">Không có lượt nào</td></tr>';
      } catch (e) { showMsg('g_msg', e.message, false); }
    });
    window.retryGrantUi = async function (grantId) {
      try { var r = await oaApi('/gifts/retry', { grantId: grantId }); showMsg('g_msg', 'Kết quả gửi lại: ' + r.outcome.status + (r.outcome.error ? ' — ' + r.outcome.error : ''), r.outcome.status === 'delivered'); el('g_grants_btn').click(); }
      catch (e) { showMsg('g_msg', e.message, false); }
    };

    // ---------- Nhãn OA ----------
    async function loadTags() {
      try {
        var rules = await oaApi('/tags/rules');
        el('t_rules').innerHTML = '<b>Luật:</b><br>' + rules.rules.map(function (r) { return '• ' + esc(r); }).join('<br>');
        var data = await oaApi('/tags/registry');
        el('tagsTable').querySelector('tbody').innerHTML = data.tags.map(function (t) {
          return '<tr><td>' + esc(t.ghl_tag) + '</td><td>' + esc(t.oa_name) + '</td><td class="muted">' + esc(t.description || '') + '</td><td>' + (t.active ? 'có' : 'tắt') + '</td><td>' +
            (t.active ? '<button class="btn-small danger" onclick="deactivateTagUi(' + t.id + ')">Tắt</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td class="muted" colspan="5">Chưa đăng ký nhãn nào</td></tr>';
      } catch (e) { showMsg('t_msg', 'Không tải được nhãn: ' + e.message + ' (đã chạy sql/007 trên Supabase chưa?)', false); }
    }
    var checkTimer = null;
    el('t_name').addEventListener('input', function () {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(async function () {
        if (!el('t_name').value.trim()) { showMsg('t_name_msg', '', true); return; }
        try {
          var r = await oaApi('/tags/check', { name: el('t_name').value });
          showMsg('t_name_msg', r.ok ? 'Hợp lệ → tag CRM: ' + r.ghlTag + (r.existsOnOa ? '\nLưu ý: nhãn này ĐÃ CÓ trên OA — đăng ký nghĩa là CRM sẽ quản lý nhãn đó.' : '') : r.error, r.ok);
        } catch (e) { showMsg('t_name_msg', e.message, false); }
      }, 400);
    });
    async function registerTagUi(adopt) {
      try {
        var r = await oaApi('/tags/register', { name: el('t_name').value, description: el('t_desc').value, adoptExisting: adopt });
        var ghl = r.ghlCreated && !r.ghlCreated.ok ? '\nCẢNH BÁO tạo tag trên GHL: ' + r.ghlCreated.error : '';
        showMsg('t_msg', 'Đã đăng ký nhãn ' + r.tag.oa_name + '.' + ghl, !ghl);
        el('t_name').value = ''; el('t_desc').value = ''; loadTags();
      } catch (e) {
        if (e.data && e.data.needsConfirm && confirm(e.data.error + '\n\nXác nhận đăng ký?')) return registerTagUi(true);
        showMsg('t_msg', e.message, false);
      }
    }
    el('t_register').addEventListener('click', function () { registerTagUi(false); });
    window.deactivateTagUi = async function (id) {
      if (!confirm('Tắt nhãn này? Từ đó CRM không còn đồng bộ nhãn này nữa (nhãn đã gắn trên OA giữ nguyên).')) return;
      try { await oaApi('/tags/deactivate', { id: id }); loadTags(); } catch (e) { showMsg('t_msg', e.message, false); }
    };
    el('t_pull_dry').addEventListener('click', async function () {
      try {
        var r = await oaApi('/tags/pull', {});
        showMsg('t_pull_msg', r.contactsWithUid + ' khách có Zalo UID sẽ được kéo nhãn từ OA về CRM (mỗi khách 1 lần gọi Zalo, cách nhau 0,25 giây).', true);
        el('t_pull_go').style.display = 'inline-block';
      } catch (e) { showMsg('t_pull_msg', e.message, false); }
    });
    el('t_pull_go').addEventListener('click', async function () {
      if (!confirm('Kéo nhãn từ OA về CRM cho toàn bộ khách có UID?')) return;
      try { var r = await oaApi('/tags/pull', { confirm: 'yes' }); showMsg('t_pull_msg', 'Đã xếp hàng ' + r.queued + '/' + r.contactsWithUid + ' khách. Xem tiến độ ở nhật ký.', true); el('t_pull_go').style.display = 'none'; }
      catch (e) { showMsg('t_pull_msg', e.message, false); }
    });
    el('t_log_btn').addEventListener('click', async function () {
      try {
        var r = await oaApi('/tags/log', { limit: 50 });
        el('tagLogTable').querySelector('tbody').innerHTML = r.log.map(function (l) {
          return '<tr><td class="muted">' + esc(new Date(l.created_at).toLocaleString('vi-VN')) + '</td><td>' + esc(l.phone || '') + '</td><td>' + esc(l.status) + '</td><td class="muted">' +
            esc([(l.added || []).length ? '+' + l.added.join(',') : '', (l.removed || []).length ? '−' + l.removed.join(',') : '', l.detail || ''].filter(Boolean).join(' · ')) + '</td></tr>';
        }).join('') || '<tr><td class="muted" colspan="4">Chưa có nhật ký</td></tr>';
      } catch (e) { showMsg('t_msg', e.message, false); }
    });

    // ---------- Tương tác & OA ----------
    function row(ok, label, detail) {
      return '<div style="margin:6px 0"><b style="color:' + (ok ? '#2f7d54' : '#a23b2e') + '">' + (ok ? '✔' : '✘') + '</b> ' + esc(label) + (detail ? ' <span class="muted">— ' + esc(detail) + '</span>' : '') + '</div>';
    }
    el('s_oauth').addEventListener('click', function () { el('s_oauth').href = '/admin/oa/zalo-oauth-start?secret=' + encodeURIComponent(secret()); });
    el('s_check').addEventListener('click', async function () {
      try {
        var r = await oaApi('/status');
        var h = '';
        h += row(r.env.ZALO_OA_APP_ID && r.env.ZALO_OA_APP_SECRET, 'ZALO_OA_APP_ID / ZALO_OA_APP_SECRET trên Render');
        h += row(r.env.ZALO_OA_WEBHOOK_SECRET, 'ZALO_OA_WEBHOOK_SECRET trên Render (OA Secret Key ở trang Webhook của Zalo)');
        h += row(r.env.GHL_WEBHOOK_SECRET, 'GHL_WEBHOOK_SECRET trên Render (cho Workflow đồng bộ tag CRM → OA)');
        h += row(r.oaAuth.ok, 'Quyền OA (refresh token trong GHL)', r.oaAuth.ok ? 'token còn ' + r.oaAuth.detail.tokenExpiresInSec + ' giây' : r.oaAuth.error + ' → bấm "Cấp quyền OA (lần đầu)". URL callback cần đăng ký trong Zalo: ' + r.oaCallbackUrl);
        h += row(r.ghlCustomFieldsScope.ok, 'GHL: quyền custom fields', r.ghlCustomFieldsScope.ok ? r.ghlCustomFieldsScope.detail : r.ghlCustomFieldsScope.error);
        h += row(r.ghlTagsScope.ok, 'GHL: quyền tags', r.ghlTagsScope.ok ? r.ghlTagsScope.detail : r.ghlTagsScope.error);
        var missing = r.dynamicFields.ok ? r.dynamicFields.detail.filter(function (f) { return !f.exists; }) : [];
        h += row(r.dynamicFields.ok && missing.length === 0, 'Field ngày trên GHL', missing.length ? 'còn thiếu: ' + missing.map(function (f) { return f.name; }).join(', ') : '');
        el('s_fields').style.display = missing.length ? 'inline-block' : 'none';
        Object.keys(r.tables).forEach(function (t) { h += row(r.tables[t].ok, 'Bảng ' + t, r.tables[t].ok ? '' : 'chưa tạo → chạy sql/007 trong Supabase'); });
        el('s_checklist').innerHTML = h; showMsg('s_msg', '', true);
      } catch (e) { showMsg('s_msg', e.message, false); }
    });
    el('s_fields').addEventListener('click', async function () {
      if (!confirm('Tạo các field ngày còn thiếu trên GHL (field trùng tên có sẵn sẽ được dùng lại, không tạo trùng)?')) return;
      try { var r = await oaApi('/setup-fields', { confirm: 'yes' }); showMsg('s_msg', r.fields.map(function (f) { return f.name + ': ' + (f.created ? 'đã tạo' : 'đã có'); }).join('\n'), true); el('s_check').click(); }
      catch (e) { showMsg('s_msg', e.message, false); }
    });
    el('s_sum_btn').addEventListener('click', async function () {
      try { var r = await oaApi('/summary'); el('s_sum').textContent = JSON.stringify(r, null, 2); el('s_sum').style.whiteSpace = 'pre-wrap'; }
      catch (e) { showMsg('s_msg', e.message, false); }
    });
    el('s_lookup_btn').addEventListener('click', async function () {
      try { var r = await oaApi('/lookup', { phone: el('s_phone').value }); el('s_lookup').textContent = JSON.stringify(r, null, 2); }
      catch (e) { el('s_lookup').textContent = e.message; }
    });

    // Tải dữ liệu 3 tab sau khi trang nội dung đã tải xong (cần state.courses/articles).
    window.loadOaTabs = function () { loadGifts(); loadTags(); };
`;
