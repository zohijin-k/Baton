"use client";
import { toast } from "./Overlay";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast("복사하지 못했어요");
    return false;
  }
}
