import type { MenuItem } from "./hooks/useMenuItems";

// ↔ تجميع عناصر menu_items فى صفوف صفحة القائمة (منطق صرف قابل للاختبار: scripts/test-units.mjs).
//   صف «الخدمات» (action_type=route و action_value=/services) هو قسم «الخدمات» نفسه (شريط كروت الشركات + «أضف شركتك») وليس كارتًا:
//   يُرسم كصف مستقل بعرض الصفحة فى موضعه من الترتيب (يتحكم فيه الأدمن بأسهم ↑/↓)، ولا يقترن بأى كارت آخر أبدًا.
export function isServicesMenuItem(item: Pick<MenuItem, "actionType" | "actionValue">): boolean {
  return item.actionType === "route" && item.actionValue.trim() === "/services";
}

export type Row =
  | { type: "services"; item: MenuItem }
  | { type: "full"; item: MenuItem }
  | { type: "pair"; items: [MenuItem, MenuItem] }
  | { type: "tallPair"; tall: MenuItem; stack: [MenuItem, MenuItem] }
  | { type: "stackTall"; tall: MenuItem; stack: [MenuItem, MenuItem] }
  | { type: "roundPair"; round: MenuItem; wide: MenuItem }
  | { type: "wideRound"; wide: MenuItem; round: MenuItem };

export function buildRows(rawItems: MenuItem[]): Row[] {
  // صف «الخدمات» يُعامَل دائمًا كعرض كامل مهما كان size المخزَّن فى القاعدة، فلا يدخل فى أى اقتران مع الكروت المجاورة.
  const menuItems: MenuItem[] = rawItems.map((i) => (isServicesMenuItem(i) ? { ...i, size: "full" } : i));
  const rows: Row[] = [];
  for (let i = 0; i < menuItems.length; i++) {
    const item = menuItems[i];
    const a = menuItems[i + 1];
    const b = menuItems[i + 2];
    // ↔ صف «الخدمات» دائمًا صف مستقل بعرض الشاشة (لا يقترن بأى كارت).
    if (isServicesMenuItem(item)) {
      rows.push({ type: "services", item });
      continue;
    }
    if (item.size === "tall") {
      if (a?.size === "half" && b?.size === "half") {
        rows.push({ type: "tallPair", tall: item, stack: [a, b] });
        i += 2;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "round") {
      if (a?.size === "half") {
        rows.push({ type: "roundPair", round: item, wide: a });
        i += 1;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "full") {
      rows.push({ type: "full", item });
      continue;
    }
    // item.size === "half"
    if (a?.size === "half" && b?.size === "tall") {
      rows.push({ type: "stackTall", tall: b, stack: [item, a] });
      i += 2;
      continue;
    }
    if (a?.size === "round") {
      rows.push({ type: "wideRound", wide: item, round: a });
      i += 1;
      continue;
    }
    if (a?.size === "half") {
      rows.push({ type: "pair", items: [item, a] });
      i += 1;
      continue;
    }
    rows.push({ type: "full", item });
  }
  return rows;
}

