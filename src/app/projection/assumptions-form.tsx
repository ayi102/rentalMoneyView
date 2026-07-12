"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAssumptions } from "@/lib/actions";
import { currency } from "@/lib/format";

export function AssumptionsForm({
  propertyId,
  currentValue,
  isEstimatedValue,
  estimatedValue,
  appreciationPct,
  discountPct,
  sellingCostPct,
  reinvestPct,
}: {
  propertyId: string;
  currentValue: number;
  isEstimatedValue: boolean;
  estimatedValue: number;
  appreciationPct: number;
  discountPct: number;
  sellingCostPct: number;
  reinvestPct: number;
}) {
  const router = useRouter();
  // If the value is currently estimated, leave the box blank (placeholder shows estimate).
  const [value, setValue] = useState(isEstimatedValue ? "" : String(Math.round(currentValue)));
  const [appr, setAppr] = useState(String(appreciationPct));
  const [disc, setDisc] = useState(String(discountPct));
  const [sell, setSell] = useState(String(sellingCostPct));
  const [reinv, setReinv] = useState(String(reinvestPct));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    setPending(true);
    try {
      await updateAssumptions(propertyId, {
        currentValue: value.trim() === "" ? null : parseFloat(value),
        appreciationPct: parseFloat(appr) || 0,
        discountPct: parseFloat(disc) || 0,
        sellingCostPct: parseFloat(sell) || 0,
        reinvestPct: parseFloat(reinv) || 0,
      });
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const field =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent tabular-nums";
  const label = "block text-xs font-medium text-muted mb-1";

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">Assumptions</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="col-span-2 md:col-span-1">
          <label className={label}>Current value ($)</label>
          <input
            type="number"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder={`≈ ${Math.round(estimatedValue)}`}
            className={field}
          />
          <p className="mt-0.5 text-[11px] text-muted">
            {isEstimatedValue && value.trim() === ""
              ? `estimated ${currency(estimatedValue)}`
              : "blank = estimate"}
          </p>
        </div>
        <Num label="Appreciation %/yr" v={appr} set={setAppr} onEdit={() => setSaved(false)} field={field} labelCls={label} />
        <Num label="Discount % (NPV)" v={disc} set={setDisc} onEdit={() => setSaved(false)} field={field} labelCls={label} />
        <Num label="Selling cost %" v={sell} set={setSell} onEdit={() => setSaved(false)} field={field} labelCls={label} />
        <Num label="Reinvest % (MIRR)" v={reinv} set={setReinv} onEdit={() => setSaved(false)} field={field} labelCls={label} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Update"}
        </button>
        {saved && <span className="text-sm text-positive">Saved ✓</span>}
      </div>
    </div>
  );
}

function Num({
  label,
  v,
  set,
  onEdit,
  field,
  labelCls,
}: {
  label: string;
  v: string;
  set: (s: string) => void;
  onEdit: () => void;
  field: string;
  labelCls: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step="0.1"
        value={v}
        onChange={(e) => {
          set(e.target.value);
          onEdit();
        }}
        className={field}
      />
    </div>
  );
}
