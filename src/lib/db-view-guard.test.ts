import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ни одно представление не отдаёт чужой кабинет.
 *
 * ── Почему это нельзя оставить на RLS ─────────────────────────────────────
 *
 * Представления здесь намеренно обычные, а не `security_invoker`: они работают
 * правами владельца, и это нужно по делу — `clients_view` читает телефон и
 * почту, которые самому `authenticated` читать запрещено (0006), и решает,
 * показывать их или подставить пустоту. Плата за это ровно одна: **RLS через
 * такое представление не проходит**.
 *
 * Проверено опытом 01.09.2026, а не вычитано: голое представление над
 * `products` без единого условия, заведённое тем же владельцем, показало
 * вошедшему чужой кабинет — 8 строк там, где сама таблица отдаёт 7. То есть
 * защита у этих двенадцати не общая, а у каждого своя, написанная руками в
 * `where`: `is_workspace_member(...)`, `workspace_role_for(...)`, `my_clients()`.
 *
 * Отсюда и этот сторож. Все двенадцать сейчас фильтруют правильно — измерено
 * подсаженными чужими строками, ноль видимых во всех. Опасность не в них, а в
 * тринадцатом: представление, написанное завтра без такой строчки, отдаст
 * медицинские карты соседней клиники и ничего об этом не скажет. Ни один тест
 * на данных этого не поймает — в одном кабинете чужих строк не бывает.
 */

/** Слова, любое из которых означает «строки отфильтрованы по вошедшему». */
const GUARDS = [
  "can_manage_client(",
  "is_workspace_member(",
  "workspace_role_for(",
  "my_clients()",
  "my_workspaces()",
  "my_managed_workspaces()",
  "auth.uid()",
];

export type ViewDef = { name: string; body: string; file: string };

/**
 * Последнее определение каждого представления по всем миграциям.
 *
 * Именно последнее: `create or replace` переписывает предыдущее целиком, и
 * судить надо по тому, что стоит в базе сейчас. Удалённые (`drop view`)
 * выбрасываются — их в базе нет.
 */
export function collectViews(files: Array<{ name: string; sql: string }>): ViewDef[] {
  const latest = new Map<string, ViewDef>();

  for (const { name: file, sql } of files) {
    // Начало строки, иначе поймается объяснение в комментарии: про
    // `create or replace view` в этих миграциях написано немало.
    const created = /^[ \t]*create (?:or replace )?view\s+(?:public\.)?(\w+)\s+as\b/gim;
    for (let m = created.exec(sql); m; m = created.exec(sql)) {
      const end = sql.indexOf(";", m.index);
      latest.set(m[1], {
        name: m[1],
        body: sql.slice(m.index, end < 0 ? sql.length : end),
        file,
      });
    }

    const dropped = /^[ \t]*drop view (?:if exists )?(?:public\.)?(\w+)/gim;
    for (let m = dropped.exec(sql); m; m = dropped.exec(sql)) {
      latest.delete(m[1]);
    }
  }

  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function isGuarded(body: string): boolean {
  return GUARDS.some((g) => body.includes(g));
}

const DIR = "supabase/migrations";
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(`${DIR}/${name}`, "utf8") }));

const VIEWS = collectViews(FILES);

describe("представления", () => {
  it("находятся все, а не половина", () => {
    // Если разбор однажды перестанет их видеть, проверка ниже станет зелёной
    // от того, что проверять нечего. Двенадцать — то, что стоит в базе.
    expect(VIEWS.length).toBeGreaterThanOrEqual(12);
    expect(VIEWS.map((v) => v.name)).toContain("clients_view");
    expect(VIEWS.map((v) => v.name)).toContain("products_view");
  });

  it.each(VIEWS.map((v) => [v.name, v] as const))(
    "%s отбирает строки по вошедшему",
    (_name, view) => {
      expect(
        isGuarded(view.body),
        `${view.name} (${view.file}) не называет ни одного из: ${GUARDS.join(", ")}. ` +
          "RLS через обычное представление не проходит — значит этот отдаст чужой кабинет.",
      ).toBe(true);
    },
  );

  it("ловит голое представление, а не соглашается со всем подряд", () => {
    // Контроль: без него зелёный цвет ничего не значит. Ровно такое голое
    // представление 01.09.2026 и показало вошедшему чужой кабинет.
    expect(isGuarded("create view public.bare_view as select * from products")).toBe(false);
    const parsed = collectViews([
      { name: "proba.sql", sql: "create view public.bare_view as select * from products;" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(isGuarded(parsed[0].body)).toBe(false);
  });

  it("судит по последнему определению, а удалённые не судит вовсе", () => {
    const parsed = collectViews([
      { name: "1.sql", sql: "create view public.x as select 1;" },
      { name: "2.sql", sql: "create or replace view public.x as select is_workspace_member(w);" },
      { name: "3.sql", sql: "create view public.y as select 1;\ndrop view if exists public.y;" },
    ]);
    expect(parsed.map((v) => v.name)).toEqual(["x"]);
    expect(isGuarded(parsed[0].body)).toBe(true);
  });
});
