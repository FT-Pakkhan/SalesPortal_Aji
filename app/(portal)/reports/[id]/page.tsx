'use client';

import React, { use } from 'react';
import ReportRun from '@/components/reports/ReportRun';

export default function ReportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReportRun docEntry={parseInt(id)} />;
}
