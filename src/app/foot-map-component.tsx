"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addFootCondition, deleteFootCondition } from "@/app/clients/[id]/foot-map/actions";

const CONDITION_TYPES = [
  { value: "мозоль", color: "#AD8642" },
  { value: "трещина", color: "#B3462C" },
  { value: "вросший ноготь", color: "#12233F" },
  { value: "бородавка", color: "#2F8F86" },
  { value: "другое", color: "#5A6B84" },
] as const;

function colorFor(conditionType: string) {
  return CONDITION_TYPES.find((c) => c.value === conditionType)?.color ?? "#5A6B84";
}

type Condition = {
  id: string;
  foot: "left" | "right";
  x: number;
  y: number;
  condition_type: string;
  note: string | null;
  visit_id: string | null;
};

type Visit = { id: string; visit_date: string };

function FootSilhouette({ mirrored }: { mirrored: boolean }) {
  return (
    <svg viewBox="0 0 100 220" className="pointer-events-none absolute inset-0 h-full w-full">
      <g
        fill="var(--muted)"
        stroke="var(--border)"
        strokeWidth={1}
        transform={mirrored ? "translate(100,0) scale(-1,1)" : undefined}
      >
        <ellipse cx="50" cy="172" rx="25" ry="40" />
        <ellipse cx="50" cy="112" rx="21" ry="46" />
        <ellipse cx="50" cy="56" rx="27" ry="34" />
        <circle cx="30" cy="17" r="9.5" />
        <circle cx="45" cy="9" r="7.5" />
        <circle cx="58" cy="7" r="6.8" />
        <circle cx="70" cy="9" r="6.2" />
        <circle cx="80" cy="15" r="5.6" />
      </g>
    </svg>
  );
}

function FootPanel({
  label,
  mirrored,
  conditions,
  pendingXY,
  onClick,
  onMarkerClick,
}: {
  label: string;
  mirrored: boolean;
  conditions: Condition[];
  pendingXY: { x: number; y: number } | null;
  onClick: (x: number, y: number) => void;
  onMarkerClick: (condition: Condition) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-center text-sm font-medium text-muted-foreground">{label}</p>
      <div
        className="relative mx-auto aspect-[100/220] w-full max-w-[220px] cursor-crosshair sm:max-w-[160px]"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          onClick(x, y);
        }}
      >
        <FootSilhouette mirrored={mirrored} />
        {conditions.map((c) => (
          <button
            key={c.id}
            type="button"
            title={`${c.condition_type}${c.note ? " — " + c.note : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onMarkerClick(c);
            }}
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow"
            style={{ left: `${c.x}%`, top: `${c.y}%`, background: colorFor(c.condition_type) }}
          />
        ))}
        {pendingXY && (
          <span
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-primary"
            style={{ left: `${pendingXY.x}%`, top: `${pendingXY.y}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function FootMap({
  clientId,
  conditions,
  visits,
}: {
  clientId: string;
  conditions: Condition[];
  visits: Visit[];
}) {
  const [pending, setPending] = useState<{ foot: "left" | "right"; x: number; y: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<Condition | null>(null);

  const byFoot = (foot: "left" | "right") => conditions.filter((c) => c.foot === foot);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-8 rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:grid-cols-2">
        <FootPanel
          label="Левая стопа"
          mirrored={false}
          conditions={byFoot("left")}
          pendingXY={pending?.foot === "left" ? pending : null}
          onClick={(x, y) => {
            setSelected(null);
            setPending({ foot: "left", x, y });
          }}
          onMarkerClick={setSelected}
        />
        <FootPanel
          label="Правая стопа"
          mirrored
          conditions={byFoot("right")}
          pendingXY={pending?.foot === "right" ? pending : null}
          onClick={(x, y) => {
            setSelected(null);
            setPending({ foot: "right", x, y });
          }}
          onMarkerClick={setSelected}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {CONDITION_TYPES.map((c) => (
          <span key={c.value} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: c.color }} />
            {c.value}
          </span>
        ))}
      </div>

      {pending && (
        <form
          action={addFootCondition.bind(null, clientId)}
          className="space-y-3 rounded-xl border border-primary/40 bg-card p-4 shadow-sm"
        >
          <p className="text-sm font-medium">
            Новая метка — {pending.foot === "left" ? "левая" : "правая"} стопа
          </p>
          <input type="hidden" name="foot" value={pending.foot} />
          <input type="hidden" name="x" value={pending.x} />
          <input type="hidden" name="y" value={pending.y} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="condition_type">Тип проблемы</Label>
              <select
                id="condition_type"
                name="condition_type"
                required
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                {CONDITION_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="visit_id">Визит</Label>
              <select
                id="visit_id"
                name="visit_id"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">Без привязки</option>
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {new Date(visit.visit_date).toLocaleDateString("ru-RU")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Заметка</Label>
            <Textarea id="note" name="note" rows={2} />
          </div>
          <div className="flex gap-2">
            <Button type="submit">Добавить метку</Button>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {selected && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          <p className="text-sm font-medium">
            {selected.condition_type} — {selected.foot === "left" ? "левая" : "правая"} стопа
          </p>
          {selected.note && <p className="text-sm text-muted-foreground">{selected.note}</p>}
          <form
            action={async () => {
              await deleteFootCondition(clientId, selected.id);
              setSelected(null);
            }}
          >
            <Button type="submit" variant="destructive" size="sm">
              Удалить метку
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
