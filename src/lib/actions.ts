"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

function parseFlags(fd: FormData) {
  return {
    countsTowardCost: fd.get("countsTowardCost") === "on",
    taxDeductible: fd.get("taxDeductible") === "on",
    isCapital: fd.get("isCapital") === "on",
  };
}

function baseFields(fd: FormData) {
  const kind = String(fd.get("kind") || "expense");
  const category = String(fd.get("category") || "").trim();
  const subRaw = String(fd.get("subcategory") || "").trim();
  const amount = Math.abs(Number(fd.get("amount")));
  const dateStr = String(fd.get("date") || "");
  const description = String(fd.get("description") || "").trim();
  return {
    kind: kind === "income" ? "income" : "expense",
    category,
    subcategory: subRaw || null,
    amount: Number.isFinite(amount) ? amount : 0,
    date: dateStr ? new Date(dateStr) : new Date(),
    description: description || null,
  };
}

export async function createTransaction(fd: FormData) {
  const propertyId = String(fd.get("propertyId") || "");
  if (!propertyId) throw new Error("Missing propertyId");
  const base = baseFields(fd);
  if (!base.category || base.amount <= 0) return; // ignore incomplete rows
  await prisma.transaction.create({
    data: { propertyId, ...base, ...parseFlags(fd) },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

export async function updateTransaction(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) throw new Error("Missing id");
  const base = baseFields(fd);
  await prisma.transaction.update({
    where: { id },
    data: { ...base, ...parseFlags(fd) },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

/** Flip a single boolean flag inline from the ledger. */
export async function toggleTransactionFlag(
  id: string,
  flag: "countsTowardCost" | "taxDeductible" | "isCapital",
) {
  const t = await prisma.transaction.findUnique({ where: { id } });
  if (!t) return;
  await prisma.transaction.update({
    where: { id },
    data: { [flag]: !t[flag] },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

export async function deleteTransaction(id: string) {
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/ledger");
}
