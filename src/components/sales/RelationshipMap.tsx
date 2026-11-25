'use client';

import React, { useEffect, useState } from 'react';
import { App, Modal } from 'antd';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { relationshipMapAPI } from '@/lib/apiClient';
import { StatusTag } from '@/components/ui/StatusTag';
import type { MapDocument, RelationshipMapData } from '@/types';

/** Left to right: the order documents are copied in (a map only shows the columns it has documents for) */
const COLUMNS = ['FTS11LEAD', 'FTS11OCRD', 'FTS11OQUT', 'FTS11ORDR', 'FTS11OTRQ', 'FTS11TMPR'];
/** Where a document opens, and its box colour */
const DOC_LOOK: Record<string, { path: string; colour: string }> = {
  FTS11LEAD: { path: '/leads', colour: '#0f828f' },
  FTS11OCRD: { path: '/convert-to-customer', colour: '#c0399f' },
  FTS11OQUT: { path: '/sales-quotations', colour: '#0a6ed1' },
  FTS11ORDR: { path: '/sales-orders', colour: '#e9730c' },
  FTS11OTRQ: { path: '/banking/receipt-requests', colour: '#7a41dc' },
  FTS11TMPR: { path: '/banking/temporary-receipts', colour: '#256f3a' },
};

const BOX_W = 250;
const BOX_H = 118;
const COL_GAP = 120;
const ROW_GAP = 20;
const PAD = 24;

const money = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Placed {
  doc: MapDocument;
  x: number;
  y: number;
}

/**
 * Lay the documents out in columns (Sales Quotations, then Sales Orders). A column's documents are ordered by the
 * documents they come from, so the arrows cross as little as possible; columns are centred on each other.
 */
function layout(map: RelationshipMapData): Placed[] {
  const columns = COLUMNS.map((objType) => map.nodes.filter((n) => n.objType === objType)).filter((c) => c.length > 0);
  const rowOf = new Map<string, number>();
  const ordered = columns.map((docs, ci) => {
    const sorted = [...docs].sort((a, b) => {
      if (ci > 0) {
        const rank = (d: MapDocument) =>
          Math.min(...map.edges.filter((e) => e.to === d.id).map((e) => rowOf.get(e.from) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
      }
      return a.docEntry - b.docEntry;
    });
    sorted.forEach((d, i) => rowOf.set(d.id, i));
    return sorted;
  });
  const tallest = Math.max(...ordered.map((c) => c.length));
  return ordered.flatMap((docs, ci) => {
    const offset = ((tallest - docs.length) * (BOX_H + ROW_GAP)) / 2;
    return docs.map((doc, ri) => ({ doc, x: PAD + ci * (BOX_W + COL_GAP), y: PAD + offset + ri * (BOX_H + ROW_GAP) }));
  });
}

/**
 * Relationship Map (as in SAP B1) of a document (Lead, Convert to Customer, Sales Quotation, Sales Order, Temporary
 * Receipt Request, Temporary Receipt): the documents it was copied from and those
 * copied from it, followed both ways. The document it was opened from is highlighted; a click on another opens it.
 */
export function RelationshipMap({ open, objType, docEntry, onClose }: { open: boolean; objType: string; docEntry: number; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [map, setMap] = useState<RelationshipMapData | null>(null);

  useEffect(() => {
    if (!open) return;
    setMap(null);
    relationshipMapAPI
      .get(objType, docEntry)
      .then((res) => res.success && setMap(res.data))
      .catch(() => {
        message.error('Failed to load the relationship map');
        onClose();
      });
  }, [open, objType, docEntry]);

  const placed = map ? layout(map) : [];
  const at = new Map(placed.map((p) => [p.doc.id, p]));
  const width = Math.max(...placed.map((p) => p.x + BOX_W), 0) + PAD;
  const height = Math.max(...placed.map((p) => p.y + BOX_H), 0) + PAD;

  const openDocument = (doc: MapDocument) => {
    if (map && doc.id === map.startId) return;
    const look = DOC_LOOK[doc.objType];
    if (!look) return;
    onClose();
    router.push(`${look.path}/${doc.docEntry}`);
  };

  return (
    <Modal open={open && !!map} title="Relationship Map" footer={null} onCancel={onClose} width="90vw" destroyOnHidden>
      {map && (
        <>
          {map.truncated && <div style={{ color: '#bb0000', marginBottom: 8 }}>Too many linked documents: only the first 200 are shown.</div>}
          <div style={{ overflow: 'auto', maxHeight: '78vh', background: '#f7f9fb', border: '1px solid #e5e5e5', borderRadius: 4 }}>
            <div style={{ position: 'relative', width, height }}>
              {/* Arrows: from the document copied from to the document copied into */}
              <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <defs>
                  <marker id="rm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#6a6d70" />
                  </marker>
                </defs>
                {map.edges.map((e) => {
                  const a = at.get(e.from);
                  const b = at.get(e.to);
                  if (!a || !b) return null;
                  const x1 = a.x + BOX_W;
                  const y1 = a.y + BOX_H / 2;
                  const x2 = b.x - 2;
                  const y2 = b.y + BOX_H / 2;
                  const mid = (x1 + x2) / 2;
                  return (
                    <path
                      key={`${e.from}>${e.to}`}
                      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="#6a6d70"
                      strokeWidth={1.5}
                      markerEnd="url(#rm-arrow)"
                    />
                  );
                })}
              </svg>
              {placed.map(({ doc, x, y }) => {
                const isStart = doc.id === map.startId;
                const look = DOC_LOOK[doc.objType];
                return (
                  <div
                    key={doc.id}
                    onClick={() => openDocument(doc)}
                    title={isStart ? 'This document' : 'Click to open'}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: y,
                      width: BOX_W,
                      height: BOX_H,
                      background: isStart ? '#fff8e1' : '#fff',
                      border: `${isStart ? 2 : 1}px solid ${isStart ? '#f0ab00' : '#c8ccd0'}`,
                      borderLeft: `5px solid ${look?.colour ?? '#6a6d70'}`,
                      borderRadius: 4,
                      padding: '6px 10px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                      cursor: isStart ? 'default' : 'pointer',
                      fontSize: 12,
                      lineHeight: '18px',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: look?.colour }}>{doc.typeName}</span>
                      <StatusTag code={doc.docStatus} label={doc.docStatusName} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>No. {doc.docNum ?? 'Draft'}</div>
                    <div>{doc.docDate ? dayjs(doc.docDate).format('DD.MM.YY') : ''}</div>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {/* A lead not converted yet has no customer code: its name only */}
                      {[doc.cardCode, doc.cardName].filter(Boolean).join(' - ')}
                    </div>
                    {/* Lead and Convert to Customer have no total */}
                    {doc.docTotal !== null && <div>Total: {money(doc.docTotal)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
