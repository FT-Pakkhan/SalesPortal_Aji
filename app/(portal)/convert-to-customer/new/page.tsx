'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomerConversionDetail from '@/components/sales/CustomerConversionDetail';

/**
 * ?lead=5 (the Lead screen's Copy To Convert to Customer) starts from that lead. This page is prerendered (static), so
 * the page's searchParams prop comes empty in a production build: the address is read in the browser instead.
 */
function NewConversion() {
  const lead = useSearchParams().get('lead');
  const leadEntry = lead ? parseInt(lead) : NaN;
  return <CustomerConversionDetail leadEntry={Number.isInteger(leadEntry) ? leadEntry : undefined} />;
}

export default function CreateCustomerConversionPage() {
  return (
    <Suspense fallback={null}>
      <NewConversion />
    </Suspense>
  );
}
