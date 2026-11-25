import type { SapBranch, SapWarehouse } from '@/types';

/** A branch (SAP Dimension 1 cost centre) as shown: Code - Name; the Name left out when empty or the Code again */
export const branchLabel = (b: SapBranch) => (b.ocrName && b.ocrName !== b.ocrCode ? `${b.ocrCode} - ${b.ocrName}` : b.ocrCode);

/** A warehouse as shown: Code - Name; the Name left out when empty or the Code again */
export const warehouseLabel = (w: SapWarehouse) => (w.whsName && w.whsName !== w.whsCode ? `${w.whsCode} - ${w.whsName}` : w.whsCode);

/**
 * The Branch's default warehouse for a sales document line: the warehouse with that Branch (U_Branch, the cost centre
 * code, any case) and Default = Y; several such, the first by code (the list comes sorted). None: null.
 */
export function branchWarehouse(warehouses: SapWarehouse[], branch: string | null | undefined): string | null {
  if (!branch) return null;
  const key = branch.trim().toUpperCase();
  return warehouses.find((w) => w.isDefault && (w.branch ?? '').trim().toUpperCase() === key)?.whsCode ?? null;
}
