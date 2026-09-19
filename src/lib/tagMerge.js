// Logic THUẦN (không gọi mạng) quyết định đồng bộ nhãn 2 CHIỀU giữa tag CRM
// `oa:*` và nhãn Zalo OA của cùng 1 khách — tách riêng khỏi lib/oaTagSync.js
// để test được toàn bộ các tình huống bằng dữ liệu giả.
//
// Vì sao cần "ảnh chụp" (snapshot): nếu chỉ so CRM với OA thì khi 2 bên
// khác nhau không biết bên nào VỪA ĐỔI. VD nhãn có trên OA nhưng CRM không
// có tag — là "CRM vừa gỡ tag (→ gỡ nhãn OA)" hay "OA vừa được gắn tay
// (→ thêm tag CRM)"? Ảnh chụp = tập nhãn 2 bên đã THỐNG NHẤT ở lần đồng bộ
// trước, cho biết bên nào khác ảnh chụp thì bên đó là bên vừa đổi.
//
// Tham số (đều là tên nhãn OA của các nhãn ĐÃ ĐĂNG KÝ, không phải nhãn
// khách gắn tay như Kid/Hội viên — những nhãn đó không bao giờ bị đụng):
//   managed  : Set — mọi nhãn đã đăng ký và đang bật
//   crm / oa : Set — nhãn hiện có ở CRM / ở OA (đã lọc theo managed)
//   snapshot : Set | null — trạng thái thống nhất lần trước (null = chưa từng đồng bộ)
//   origin   : "crm" | "oa" — bên nào vừa kích hoạt lần đồng bộ này
//
// Quy tắc cho từng nhãn khi CRM và OA đang KHÁC nhau:
//   • Có snapshot: bên nào khác snapshot thì bên đó vừa đổi → chép sang bên kia.
//     (Cả 2 cùng đổi mà vẫn khác nhau là không thể xảy ra với giá trị có/không.)
//   • Chưa có snapshot, origin "crm": CRM là nguồn sự thật (đúng hành vi cũ
//     trước khi có đồng bộ ngược) — thiếu thì gắn lên OA, thừa thì gỡ khỏi OA.
//   • Chưa có snapshot, origin "oa": KHÔNG BAO GIỜ gỡ gì (không đủ căn cứ để
//     biết ai đúng) — chỉ bổ sung cho bên còn thiếu.
export function planTagSync({ managed, crm, oa, snapshot = null, origin = "crm" }) {
  const toAddOa = [];
  const toRemoveOa = [];
  const toAddCrm = [];
  const toRemoveCrm = [];
  const next = new Set();

  for (const name of managed) {
    const c = crm.has(name);
    const o = oa.has(name);
    if (c === o) {
      if (c) next.add(name);
      continue;
    }

    let winner;
    if (snapshot) {
      // s === o  → OA không đổi so với lần trước → CRM là bên vừa đổi.
      // ngược lại (s === c) → CRM không đổi → OA là bên vừa đổi.
      winner = snapshot.has(name) === o ? "crm" : "oa";
    } else {
      winner = origin === "crm" ? "crm" : "add-only";
    }

    if (winner === "crm") {
      if (c) { toAddOa.push(name); next.add(name); } else { toRemoveOa.push(name); }
    } else if (winner === "oa") {
      if (o) { toAddCrm.push(name); next.add(name); } else { toRemoveCrm.push(name); }
    } else if (o) {
      toAddCrm.push(name);
      next.add(name);
    } else {
      toAddOa.push(name);
      next.add(name);
    }
  }

  return { toAddOa, toRemoveOa, toAddCrm, toRemoveCrm, nextSnapshot: [...next] };
}

export function hasChanges(plan) {
  return plan.toAddOa.length + plan.toRemoveOa.length + plan.toAddCrm.length + plan.toRemoveCrm.length > 0;
}
